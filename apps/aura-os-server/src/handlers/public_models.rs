//! Same-origin pass-through for the public model catalog.
//!
//! Mirrors the [`feedback::pub_list_feedback`](crate::handlers::feedback)
//! pattern: proxies `GET /api/public/models` to aura-network's
//! `/api/public/models` using the server-side `AURA_NETWORK_URL` env,
//! so the marketing `/models` SPA never needs a build-time
//! `VITE_AURA_NETWORK_URL` and the upstream URL stays a server secret.
//!
//! Returns `[]` (rather than a 503) when no aura-network client is
//! configured or when the upstream call fails, matching the
//! graceful-degrade contract of the rest of the marketing surface so a
//! default Aura OS build still renders an empty catalog instead of an
//! error.

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use tracing::warn;

use crate::state::AppState;

/// Allowed mode values mirrored from aura-network's
/// `migrations/0038_create_models.sql` CHECK constraint. Unknown
/// values are dropped (treated as "no filter") rather than 400'd.
const MODES: &[&str] = &["text", "image", "video", "3d"];

/// Allowed status values mirrored from the same migration. Same
/// drop-unknown contract as `MODES`.
const STATUSES: &[&str] = &["live", "soon"];

#[derive(Debug, Deserialize)]
pub(crate) struct PublicModelsListQuery {
    pub mode: Option<String>,
    pub status: Option<String>,
    pub q: Option<String>,
}

pub(crate) async fn pub_list_models(
    State(state): State<AppState>,
    Query(query): Query<PublicModelsListQuery>,
) -> Json<Vec<serde_json::Value>> {
    let Some(client) = state.network_client.as_ref() else {
        warn!("public models requested but no aura-network client configured");
        return Json(Vec::new());
    };

    let mode = query.mode.as_deref().filter(|v| MODES.contains(v));
    let status = query.status.as_deref().filter(|v| STATUSES.contains(v));
    let q = query.q.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let mut params: Vec<(&str, String)> = Vec::with_capacity(3);
    if let Some(m) = mode {
        params.push(("mode", m.to_string()));
    }
    if let Some(s) = status {
        params.push(("status", s.to_string()));
    }
    if let Some(query_text) = q {
        params.push(("q", query_text.to_string()));
    }

    let url = format!("{}/api/public/models", client.base_url());
    let resp = match client.http_client().get(&url).query(&params).send().await {
        Ok(resp) => resp,
        Err(err) => {
            warn!(%url, error = %err, "public models upstream request failed");
            return Json(Vec::new());
        }
    };
    if !resp.status().is_success() {
        let status = resp.status();
        warn!(%url, %status, "public models upstream returned non-success");
        return Json(Vec::new());
    }
    match resp.json::<Vec<serde_json::Value>>().await {
        Ok(items) => Json(items),
        Err(err) => {
            warn!(%url, error = %err, "public models upstream returned malformed JSON");
            Json(Vec::new())
        }
    }
}
