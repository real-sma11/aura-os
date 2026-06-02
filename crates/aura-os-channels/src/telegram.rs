use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::connector::ChatConnector;
use crate::error::ChannelError;
use crate::inbound::{build_inbound, InboundHandler};
use crate::kind::ChannelKind;

/// Telegram's hard cap on a single `sendMessage` text body, in characters.
const TELEGRAM_MESSAGE_LIMIT: usize = 4096;

/// Long-poll `timeout` (seconds) passed to `getUpdates`.
const LONG_POLL_TIMEOUT_SECS: u64 = 30;

/// Per-request reqwest timeout — comfortably above the long-poll timeout.
const REQUEST_TIMEOUT_SECS: u64 = 60;

/// Back-off applied after a failed poll so a flapping network can't spin the
/// loop.
const POLL_BACKOFF: Duration = Duration::from_secs(3);

/// A [`ChatConnector`] over the Telegram Bot API.
///
/// Outbound calls hit `sendMessage` / `sendChatAction`; the inbound loop uses
/// `getUpdates` long-polling. The `base_url` is overridable so tests can point
/// at a mock server.
pub struct TelegramConnector {
    token: String,
    http: reqwest::Client,
    base_url: String,
    offset: AtomicI64,
}

impl TelegramConnector {
    /// Construct a connector from a bot token, using Telegram's public API
    /// base url and a default HTTP client.
    pub fn new(token: String) -> Self {
        Self::with_base_url(token, "https://api.telegram.org".to_string())
    }

    /// Construct a connector against a custom `base_url` (for tests).
    pub fn with_base_url(token: String, base_url: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .unwrap_or_default();
        Self {
            token,
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            offset: AtomicI64::new(0),
        }
    }

    /// Convenience async constructor mirroring other transports' `connect`.
    pub async fn connect(token: String) -> Result<Self, ChannelError> {
        Ok(Self::new(token))
    }

    fn method_url(&self, method: &str) -> String {
        format!("{}/bot{}/{}", self.base_url, self.token, method)
    }

    /// Resolve the bot's `@username` via `getMe`. Used by linking flows that
    /// build `t.me/<username>?start=<code>` deep links.
    pub async fn fetch_bot_username(&self) -> Result<String, ChannelError> {
        let url = self.method_url("getMe");
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| ChannelError::Transport(e.to_string()))?;
        let body: Value = resp
            .json()
            .await
            .map_err(|e| ChannelError::Transport(e.to_string()))?;
        body.get("result")
            .and_then(|r| r.get("username"))
            .and_then(|u| u.as_str())
            .map(|s| s.to_string())
            .ok_or(ChannelError::NotFound)
    }
}

/// Split `text` into chunks no longer than `limit` characters.
///
/// Prefers to break on a newline boundary within the window; only hard-splits
/// (mid-line) when a single line exceeds `limit`. Pure and side-effect free so
/// the chunking rule is unit-testable. Returns a single empty chunk for empty
/// input so callers always send at least one message.
pub fn split_message(text: &str, limit: usize) -> Vec<String> {
    debug_assert!(limit > 0, "limit must be positive");
    if text.is_empty() {
        return vec![String::new()];
    }

    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < chars.len() {
        let remaining = chars.len() - start;
        if remaining <= limit {
            chunks.push(chars[start..].iter().collect());
            break;
        }

        // Window we could emit this round: [start, start + limit).
        let window_end = start + limit;
        // Prefer the last newline strictly inside the window so the next chunk
        // begins after it.
        let split_at = chars[start..window_end]
            .iter()
            .rposition(|&c| c == '\n')
            .map(|rel| start + rel)
            .filter(|&nl| nl > start);

        match split_at {
            Some(nl) => {
                // Include up to (but not including) the newline; skip it.
                chunks.push(chars[start..nl].iter().collect());
                start = nl + 1;
            }
            None => {
                // No usable newline — hard split at the limit.
                chunks.push(chars[start..window_end].iter().collect());
                start = window_end;
            }
        }
    }

    chunks
}

#[async_trait]
impl ChatConnector for TelegramConnector {
    fn kind(&self) -> ChannelKind {
        ChannelKind::Telegram
    }

    async fn send_text(&self, chat_ref: &str, text: &str) -> Result<(), ChannelError> {
        let url = self.method_url("sendMessage");
        for chunk in split_message(text, TELEGRAM_MESSAGE_LIMIT) {
            let resp = self
                .http
                .post(&url)
                .json(&json!({ "chat_id": chat_ref, "text": chunk }))
                .send()
                .await
                .map_err(|e| ChannelError::Transport(e.to_string()))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(ChannelError::Transport(format!(
                    "sendMessage failed ({status}): {body}"
                )));
            }
        }
        Ok(())
    }

    async fn send_typing(&self, chat_ref: &str) -> Result<(), ChannelError> {
        let url = self.method_url("sendChatAction");
        let resp = self
            .http
            .post(&url)
            .json(&json!({ "chat_id": chat_ref, "action": "typing" }))
            .send()
            .await
            .map_err(|e| ChannelError::Transport(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(ChannelError::Transport(format!(
                "sendChatAction failed ({})",
                resp.status()
            )));
        }
        Ok(())
    }

    async fn run(
        self: Arc<Self>,
        handler: Arc<dyn InboundHandler>,
    ) -> Result<(), ChannelError> {
        let url = self.method_url("getUpdates");
        loop {
            let offset = self.offset.load(Ordering::SeqCst);
            let result = self
                .http
                .get(&url)
                .query(&[
                    ("offset", offset.to_string()),
                    ("timeout", LONG_POLL_TIMEOUT_SECS.to_string()),
                ])
                .send()
                .await;

            let resp = match result {
                Ok(resp) => resp,
                Err(e) => {
                    tracing::warn!(error = %e, "telegram getUpdates request failed");
                    tokio::time::sleep(POLL_BACKOFF).await;
                    continue;
                }
            };

            let body: Value = match resp.json().await {
                Ok(body) => body,
                Err(e) => {
                    tracing::warn!(error = %e, "telegram getUpdates decode failed");
                    tokio::time::sleep(POLL_BACKOFF).await;
                    continue;
                }
            };

            let Some(updates) = body.get("result").and_then(|r| r.as_array()) else {
                tracing::warn!("telegram getUpdates missing result array");
                tokio::time::sleep(POLL_BACKOFF).await;
                continue;
            };

            let mut max_update_id = offset - 1;
            for update in updates {
                if let Some(update_id) = update.get("update_id").and_then(|v| v.as_i64()) {
                    if update_id > max_update_id {
                        max_update_id = update_id;
                    }
                }

                // Be defensive: skip anything that isn't a text message.
                let Some(message) = update.get("message") else {
                    continue;
                };
                let Some(chat_id) = message
                    .get("chat")
                    .and_then(|c| c.get("id"))
                    .and_then(|id| id.as_i64())
                else {
                    continue;
                };
                let Some(text) = message.get("text").and_then(|t| t.as_str()) else {
                    continue;
                };

                let msg = build_inbound(chat_id.to_string(), text);
                handler.on_message(msg).await;
            }

            // Acknowledge consumed updates so Telegram drops them.
            let next_offset = max_update_id + 1;
            if next_offset > offset {
                self.offset.store(next_offset, Ordering::SeqCst);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_under_limit_single_chunk() {
        let chunks = split_message("hello world", 4096);
        assert_eq!(chunks, vec!["hello world".to_string()]);
    }

    #[test]
    fn split_empty_yields_single_empty_chunk() {
        assert_eq!(split_message("", 10), vec![String::new()]);
    }

    #[test]
    fn split_over_limit_hard_splits_when_no_newline() {
        let text = "a".repeat(25);
        let chunks = split_message(&text, 10);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].chars().count(), 10);
        assert_eq!(chunks[1].chars().count(), 10);
        assert_eq!(chunks[2].chars().count(), 5);
        for c in &chunks {
            assert!(c.chars().count() <= 10);
        }
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn split_prefers_newline_boundary() {
        // First line is 6 chars, then newline, then a long run. With limit 10
        // the split should occur on the newline, not mid-line.
        let text = "line01\nABCDEFGHIJKLMNO";
        let chunks = split_message(text, 10);
        assert_eq!(chunks[0], "line01");
        // Remaining 15 chars hard-split into <=10 windows.
        assert!(chunks[1].chars().count() <= 10);
        for c in &chunks {
            assert!(c.chars().count() <= 10);
        }
    }

    #[test]
    fn split_all_chunks_within_limit() {
        let text = "word ".repeat(3000);
        for chunk in split_message(&text, 4096) {
            assert!(chunk.chars().count() <= 4096);
        }
    }
}
