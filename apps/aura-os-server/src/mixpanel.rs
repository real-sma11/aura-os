//! Lightweight Mixpanel event tracker for server-side analytics.
//!
//! Fires `session_active` once per user per calendar day so True DAU
//! is accurate regardless of client version. Uses an in-memory
//! `DashMap` for deduplication — no external state required.

use dashmap::DashMap;
use reqwest::Client;
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tracing::warn;
use uuid::Uuid;

/// Tracks which users have already fired `session_active` today.
/// Key: `"user_id:YYYY-MM-DD"`, Value: `()`.
#[derive(Clone)]
pub struct MixpanelTracker {
    token: String,
    client: Client,
    seen_today: Arc<DashMap<String, ()>>,
    share_opens_seen_today: Arc<DashMap<String, ()>>,
}

impl MixpanelTracker {
    /// Create a new tracker. Returns `None` if the token is empty
    /// (dev/preview environments).
    pub(crate) fn new(token: &str) -> Option<Self> {
        let token = token.trim().to_string();
        if token.is_empty() {
            return None;
        }
        Some(Self {
            token,
            client: Client::new(),
            seen_today: Arc::new(DashMap::new()),
            share_opens_seen_today: Arc::new(DashMap::new()),
        })
    }

    /// Fire `session_active` for this user if it hasn't been fired
    /// today. Safe to call on every request — deduplicates internally.
    pub(crate) fn track_session_active(&self, user_id: &str) {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let key = format!("{user_id}:{today}");

        if self.seen_today.contains_key(&key) {
            return;
        }
        self.seen_today.insert(key, ());

        // Evict stale entries from previous days to prevent unbounded
        // growth. Runs inline but is O(n) with a small n (active users
        // today). Only runs when we actually insert a new entry.
        self.seen_today.retain(|k, _| k.ends_with(&today));

        self.enqueue_event("session_active", user_id.to_string(), Map::new());
    }

    /// Fire a generic Mixpanel event with JSON-object properties.
    ///
    /// The server adds Mixpanel's required metadata (`distinct_id`,
    /// project token, timestamp, insert id, and library marker). Calls
    /// are non-fatal: events are sent on a background task and failures
    /// are logged as warnings.
    pub(crate) fn track_event(
        &self,
        event: &str,
        distinct_id: impl Into<String>,
        properties: Value,
    ) {
        self.enqueue_event(event, distinct_id.into(), value_to_properties(properties));
    }

    /// Fire `share_link_opened` at most once per share token per UTC day.
    ///
    /// The raw capability token is used only to build an in-memory
    /// fingerprint for deduplication. It is never logged or sent to
    /// Mixpanel.
    pub(crate) fn track_share_link_opened(
        &self,
        token: &str,
        session_id: &str,
        has_content: bool,
        event_count: Option<u32>,
    ) {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let Some(fingerprint) = self.mark_share_opened_for_day(token, &today) else {
            return;
        };

        let mut properties = Map::new();
        properties.insert("session_id".to_string(), json!(session_id));
        properties.insert("has_content".to_string(), json!(has_content));
        if let Some(event_count) = event_count {
            properties.insert("event_count".to_string(), json!(event_count));
        }

        self.enqueue_event(
            "share_link_opened",
            format!("share:{fingerprint}"),
            properties,
        );
    }

    fn mark_share_opened_for_day(&self, token: &str, today: &str) -> Option<String> {
        let fingerprint = share_token_fingerprint(token);
        let key = share_open_key_for_day(&fingerprint, today);
        if self.share_opens_seen_today.insert(key, ()).is_some() {
            return None;
        }

        self.share_opens_seen_today
            .retain(|key, _| key.starts_with(today));
        Some(fingerprint)
    }

    fn enqueue_event(
        &self,
        event: impl Into<String>,
        distinct_id: String,
        properties: Map<String, Value>,
    ) {
        let client = self.client.clone();
        let token = self.token.clone();
        let event = event.into();
        let time = chrono::Utc::now().timestamp();
        let insert_id = Uuid::new_v4().to_string();
        let payload =
            build_event_payload(&token, &event, &distinct_id, properties, time, insert_id);

        tokio::spawn(async move {
            post_mixpanel_payload(client, payload, event).await;
        });
    }
}

fn value_to_properties(properties: Value) -> Map<String, Value> {
    match properties {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn build_event_payload(
    token: &str,
    event: &str,
    distinct_id: &str,
    mut properties: Map<String, Value>,
    time: i64,
    insert_id: String,
) -> Value {
    properties.insert("distinct_id".to_string(), json!(distinct_id));
    properties.insert("token".to_string(), json!(token));
    properties.insert("time".to_string(), json!(time));
    properties.insert("$insert_id".to_string(), json!(insert_id));
    properties.insert("mp_lib".to_string(), json!("rust-server"));

    json!([{
        "event": event,
        "properties": properties,
    }])
}

fn share_token_fingerprint(token: &str) -> String {
    blake3::hash(token.as_bytes())
        .to_hex()
        .chars()
        .take(16)
        .collect()
}

fn share_open_key_for_day(fingerprint: &str, today: &str) -> String {
    format!("{today}:{fingerprint}")
}

async fn post_mixpanel_payload(client: Client, payload: Value, event: String) {
    let result = client
        .post("https://api.mixpanel.com/track")
        .header("content-type", "application/json")
        .header("accept", "text/plain")
        .body(payload.to_string())
        .send()
        .await;

    match result {
        Ok(resp) => match resp.text().await {
            Ok(body) if body.trim() == "1" => {}
            Ok(body) => warn!("mixpanel {event} rejected: {body}"),
            Err(err) => warn!("mixpanel {event} response read failed: {err}"),
        },
        Err(err) => {
            warn!("mixpanel {event} request failed: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_merges_properties_without_overwriting_metadata_shape() {
        let payload = build_event_payload(
            "project-token",
            "share_link_generated",
            "user-1",
            value_to_properties(json!({
                "session_id": "session-1",
                "reused": true,
            })),
            123,
            "insert-1".to_string(),
        );

        assert_eq!(payload[0]["event"], "share_link_generated");
        assert_eq!(payload[0]["properties"]["distinct_id"], "user-1");
        assert_eq!(payload[0]["properties"]["token"], "project-token");
        assert_eq!(payload[0]["properties"]["time"], 123);
        assert_eq!(payload[0]["properties"]["$insert_id"], "insert-1");
        assert_eq!(payload[0]["properties"]["mp_lib"], "rust-server");
        assert_eq!(payload[0]["properties"]["session_id"], "session-1");
        assert_eq!(payload[0]["properties"]["reused"], true);
    }

    #[test]
    fn non_object_properties_become_empty_object() {
        let properties = value_to_properties(json!(["not", "an", "object"]));

        assert!(properties.is_empty());
    }

    #[test]
    fn share_open_key_uses_fingerprint_not_raw_token() {
        let token = "t_1234567890abcdef1234567890abcdef";
        let fingerprint = share_token_fingerprint(token);
        let key = share_open_key_for_day(&fingerprint, "2026-06-01");

        assert!(!fingerprint.contains(token));
        assert!(!key.contains(token));
        assert_eq!(fingerprint.len(), 16);
        assert!(key.starts_with("2026-06-01:"));
    }

    #[test]
    fn share_open_dedupe_marks_only_once_per_day() {
        let tracker = MixpanelTracker {
            token: "token".to_string(),
            client: Client::new(),
            seen_today: Arc::new(DashMap::new()),
            share_opens_seen_today: Arc::new(DashMap::new()),
        };
        let token = "t_1234567890abcdef1234567890abcdef";

        assert!(tracker
            .mark_share_opened_for_day(token, "2026-06-01")
            .is_some());
        assert!(tracker
            .mark_share_opened_for_day(token, "2026-06-01")
            .is_none());
        assert!(tracker
            .mark_share_opened_for_day(token, "2026-06-02")
            .is_some());
    }
}
