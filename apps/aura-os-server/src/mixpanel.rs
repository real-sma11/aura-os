//! Lightweight Mixpanel event tracker for server-side analytics.
//!
//! Fires `session_active` once per user per calendar day so True DAU
//! is accurate regardless of client version. Uses an in-memory
//! `DashMap` for deduplication — no external state required.

use dashmap::DashMap;
use reqwest::Client;
use serde_json::json;
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
        self.seen_today
            .retain(|k, _| k.ends_with(&today));

        let client = self.client.clone();
        let token = self.token.clone();
        let distinct_id = user_id.to_string();
        let time = chrono::Utc::now().timestamp();
        let insert_id = Uuid::new_v4().to_string();

        tokio::spawn(async move {
            let payload = json!([{
                "event": "session_active",
                "properties": {
                    "distinct_id": distinct_id,
                    "token": token,
                    "time": time,
                    "$insert_id": insert_id,
                    "mp_lib": "rust-server",
                }
            }]);

            let result = client
                .post("https://api.mixpanel.com/track")
                .header("content-type", "application/json")
                .header("accept", "text/plain")
                .body(payload.to_string())
                .send()
                .await;

            match result {
                Ok(resp) => {
                    let body = resp.text().await.unwrap_or_default();
                    if body.trim() != "1" {
                        warn!("mixpanel session_active rejected: {body}");
                    }
                }
                Err(err) => {
                    warn!("mixpanel session_active request failed: {err}");
                }
            }
        });
    }
}
