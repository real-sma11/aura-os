//! Real agent dispatch with auth-on-behalf-of-user for the external-chat
//! bridge.
//!
//! When a user messages their linked agent from an external chat platform
//! (Telegram first), [`ServerMessageDispatcher`] forwards that text into this
//! server's own chat endpoint (`/api/agents/{id}/events/stream`) authenticated
//! as the linking user, then accumulates the assistant's streamed reply back
//! into a single string to relay to the chat.
//!
//! ## Auth-on-behalf-of-user
//!
//! Each [`ChannelLink`] stores the access token captured when the user linked
//! the chat. To dispatch a turn we need a currently-valid JWT for that user:
//!
//! 1. First we scan the in-memory [`ValidationCache`] for a *fresh* session
//!    (validated within [`AUTH_REFRESH_TTL`]) owned by the same `user_id`. The
//!    cache is keyed by JWT, so a live desktop/web session for the user yields
//!    a token without a network round-trip.
//! 2. Otherwise we validate the link's stored `access_token` against zOS via
//!    [`AuthService::validate_token`]. If it still validates we reuse it.
//!
//! ## Known limitation
//!
//! There is **no durable refresh** here: tokens are long-lived bearer JWTs and
//! we never mint new ones on the user's behalf. Once the stored token expires
//! and the user has no fresh cached session, [`ServerMessageDispatcher`]
//! returns [`DispatchOutcome::NeedsRelink`] so the bridge can flag the link and
//! prompt the user to reconnect. A `401`/`403` from the chat endpoint is
//! treated the same way (the token was accepted by `validate_token` but
//! rejected downstream).

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use aura_os_auth::AuthService;
use aura_os_channels::{ChannelError, ChannelLink, DispatchOutcome, MessageDispatcher};
use futures_util::StreamExt;
use serde_json::json;
use tracing::debug;

use crate::state::ValidationCache;

/// Freshness window for reusing a cached session token, mirroring the
/// (private) `auth_guard::AUTH_REFRESH_TTL` constant. Kept as a local `const`
/// because the auth guard module is private to the crate and does not re-export
/// it; both values are 5 minutes by design.
const AUTH_REFRESH_TTL: Duration = Duration::from_secs(5 * 60);

/// `MessageDispatcher` that drives a real agent chat turn over this server's
/// own HTTP chat endpoint, authenticated as the linking user.
///
/// Constructed in Phase 4 by cloning the relevant handles off `AppState`.
pub struct ServerMessageDispatcher {
    /// Per-JWT validation cache (`Arc<DashMap<String, CachedSession>>`).
    /// Scanned for a fresh session belonging to the link's user.
    validation_cache: ValidationCache,
    /// Used to validate the link's stored access token when no fresh cached
    /// session is available.
    auth_service: Arc<AuthService>,
    /// Shared HTTP client reused for the in-process chat POST so we don't pay
    /// per-call TCP/TLS handshake cost.
    http_client: reqwest::Client,
    /// Resolved base URL of this server (e.g. `http://127.0.0.1:8787`). The
    /// chat-stream path is appended to this.
    base_url: String,
}

impl ServerMessageDispatcher {
    /// Build a dispatcher from the handles Phase 4 will clone off `AppState`.
    #[must_use]
    pub fn new(
        validation_cache: ValidationCache,
        auth_service: Arc<AuthService>,
        http_client: reqwest::Client,
        base_url: String,
    ) -> Self {
        Self {
            validation_cache,
            auth_service,
            http_client,
            base_url,
        }
    }

    /// Resolve a usable JWT for `link`'s user, or `None` when the user must
    /// re-link. See the module docs for the two-step strategy.
    async fn resolve_jwt(&self, link: &ChannelLink) -> Option<String> {
        // 1. Reuse a fresh cached session for this user, if one exists. The
        //    DashMap key *is* the JWT. We never `.await` while iterating, so
        //    no shard lock is held across a suspend point.
        for entry in self.validation_cache.iter() {
            if entry.session.user_id == link.user_id
                && entry.validated_at.elapsed() < AUTH_REFRESH_TTL
            {
                return Some(entry.key().clone());
            }
        }

        // 2. Fall back to validating the stored access token.
        match self.auth_service.validate_token(&link.access_token).await {
            Ok(_) => Some(link.access_token.clone()),
            Err(error) => {
                debug!(
                    target: "aura::channels",
                    user_id = %link.user_id,
                    %error,
                    "stored channel access token failed validation; needs relink"
                );
                None
            }
        }
    }
}

#[async_trait]
impl MessageDispatcher for ServerMessageDispatcher {
    async fn dispatch_to_agent(
        &self,
        link: &ChannelLink,
        user_text: &str,
    ) -> Result<DispatchOutcome, ChannelError> {
        let jwt = match self.resolve_jwt(link).await {
            Some(jwt) => jwt,
            None => return Ok(DispatchOutcome::NeedsRelink),
        };

        let url = format!(
            "{}/api/agents/{}/events/stream",
            self.base_url.trim_end_matches('/'),
            link.agent_id
        );

        // Mirror the `SendChatRequest` shape used by `cross_agent_reply`:
        // only `content` is meaningful here; everything else defaults so the
        // server resolves the agent's own model / latest session.
        let body = json!({
            "content": user_text,
            "action": null,
            "model": null,
            "commands": null,
            "project_id": null,
            "attachments": null,
            "new_session": false,
        });

        let response = self
            .http_client
            .post(&url)
            .bearer_auth(&jwt)
            .json(&body)
            .send()
            .await
            .map_err(|error| ChannelError::Transport(error.to_string()))?;

        let status = response.status();
        // The token validated above but was rejected by the chat endpoint:
        // treat it as a stale credential so the user re-links.
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Ok(DispatchOutcome::NeedsRelink);
        }
        if !status.is_success() {
            let preview = response
                .text()
                .await
                .unwrap_or_default()
                .chars()
                .take(400)
                .collect::<String>();
            return Err(ChannelError::Transport(format!(
                "agent stream returned {status}: {preview}"
            )));
        }

        let reply = accumulate_sse_reply(response).await?;
        Ok(DispatchOutcome::Reply(reply))
    }
}

/// Read the chat endpoint's SSE response and accumulate the assistant's text.
///
/// The wire format is the serialized `aura_protocol::OutboundMessage` enum
/// (`#[serde(tag = "type", rename_all = "snake_case")]`), so every SSE `data:`
/// frame is a JSON object with a `type` discriminator:
///   - `text_delta` → append the `text` field (incremental assistant output).
///   - `assistant_message_end` → the turn is complete; stop accumulating.
///   - `error` → surface as a [`ChannelError::Transport`].
///
/// Unknown event types (thinking deltas, tool events, heartbeats, etc.) are
/// ignored. We also stop on a bare `[DONE]` sentinel or when the stream simply
/// closes, returning whatever text was accumulated.
async fn accumulate_sse_reply(response: reqwest::Response) -> Result<String, ChannelError> {
    let mut stream = response.bytes_stream();
    // Byte buffer so a multi-byte UTF-8 char split across chunk boundaries is
    // never decoded mid-codepoint — we only decode complete `\n`-terminated
    // lines, which are always valid UTF-8 in the SSE wire format.
    let mut buf: Vec<u8> = Vec::new();
    let mut acc = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| ChannelError::Transport(error.to_string()))?;
        buf.extend_from_slice(&chunk);

        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();

            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                return Ok(acc);
            }

            let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            match value.get("type").and_then(|t| t.as_str()) {
                Some("text_delta") => {
                    if let Some(text) = value.get("text").and_then(|t| t.as_str()) {
                        acc.push_str(text);
                    }
                }
                Some("assistant_message_end") => {
                    return Ok(acc);
                }
                Some("error") => {
                    let message = value
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("agent stream reported an error");
                    return Err(ChannelError::Transport(message.to_string()));
                }
                _ => {}
            }
        }
    }

    // Stream closed without an explicit terminal frame: relay what we have.
    Ok(acc)
}
