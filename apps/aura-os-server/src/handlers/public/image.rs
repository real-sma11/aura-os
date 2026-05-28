//! `POST /api/public/generation/image` — anonymous image-mode SSE
//! handler.
//!
//! Phase 3 mirror of [`crate::handlers::generation::generate_image_stream`]:
//! same SSE event shape (forwarded by
//! [`super::generation_common::proxy_public_generation_stream`]) so
//! the chat-ui's image-rendering code paths work for public users
//! unchanged. Differences from the auth'd sibling:
//!
//! - Authenticates with [`AuthGuestJwt`] (guest JWT) instead of
//!   [`crate::state::AuthJwt`] / [`crate::state::AuthSession`].
//! - Goes through [`super::enforce_public_turn`] BEFORE the
//!   upstream open, so a failed downstream proxy cannot let the
//!   same guest retry for free.
//! - Strips every client-overridable knob (model, size, ...) and
//!   forwards a hardcoded cheap-defaults payload — the public DTO
//!   ([`PublicImageRequest`]) only accepts the prompt + an optional
//!   source url.
//! - `persist = None` — no per-user chat-history write.
//! - No billing preflight: the public-mode rate limiter (per-guest
//!   3-turn cap + per-IP daily ceiling) is the only cost guard.

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::Sse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;

use crate::error::ApiResult;
use crate::state::{AppState, AuthGuestJwt};

use super::gate::{enforce_public_turn, PublicGateCtx};
use super::generation_common::{
    caller_ip_from_headers, proxy_public_generation_stream, PublicGenerationCall,
    PublicGenerationSse,
};
use super::types::PublicModality;

/// Public image-mode model. Picked from `IMAGE_MODELS[0]` /
/// `DEFAULT_IMAGE_MODEL_ID` in [interface/src/constants/models.ts]
/// so the public default tracks the chat-app default without an
/// independent registry. Tracked as a `const` (not derived) because
/// the public surface intentionally never accepts a model override
/// from the client.
const PUBLIC_IMAGE_MODEL: &str = "gpt-image-2";

/// Smallest size every supported image model accepts. Kept tight to
/// bound abuse cost — the input bar's logged-in mode lets users pick
/// up to `1792x1024` and similar, but public users get the cheapest
/// square.
const PUBLIC_IMAGE_SIZE: &str = "1024x1024";

/// Public-mode image generation request. Locked down to the two
/// fields a logged-out caller can drive — `prompt` plus an optional
/// `source_url` for image-to-image (still bounded by the same cheap
/// defaults). Any extra fields the client tries to send are dropped
/// by serde (the struct doesn't carry `#[serde(other)]`).
#[derive(Debug, Deserialize)]
pub(crate) struct PublicImageRequest {
    pub(crate) prompt: String,
    #[serde(default, alias = "sourceUrl", alias = "imageUrl")]
    pub(crate) source_url: Option<String>,
}

/// `POST /api/public/generation/image`. Reserves a turn slot via the
/// shared gate, builds the fixed-payload upstream request, and
/// streams the upstream SSE through the public proxy (which also
/// appends the canonical `{ kind: "limit", ... }` frame at end).
pub(crate) async fn public_image_stream(
    State(state): State<AppState>,
    AuthGuestJwt(claims): AuthGuestJwt,
    headers: HeaderMap,
    Json(body): Json<PublicImageRequest>,
) -> ApiResult<Sse<PublicGenerationSse>> {
    let ip = caller_ip_from_headers(&headers);
    let guard = enforce_public_turn(&PublicGateCtx {
        state: &state,
        claims: &claims,
        ip,
        modality: PublicModality::Image,
    })?;
    info!(
        guest_id = %claims.guest_id(),
        modality = PublicModality::Image.as_str(),
        turn_count = guard.turn_count(),
        "public_image: turn accepted"
    );
    let payload = build_public_image_payload(&body);
    let bearer_token = String::new();
    proxy_public_generation_stream(
        &state,
        &bearer_token,
        PublicGenerationCall {
            upstream_path: "/v1/generate-image/stream",
            payload,
            modality: PublicModality::Image,
        },
        guard,
    )
    .await
}

/// Build the upstream router payload for a public image turn. Only
/// the caller's prompt + (optional) source image flow through; the
/// model and size are hardcoded to the cheap defaults.
fn build_public_image_payload(body: &PublicImageRequest) -> Value {
    let mut payload = json!({
        "prompt": body.prompt,
        "model": PUBLIC_IMAGE_MODEL,
        "size": PUBLIC_IMAGE_SIZE,
    });
    if let Some(source) = body.source_url.as_deref() {
        let trimmed = source.trim();
        if !trimmed.is_empty() {
            payload["images"] = json!([trimmed]);
        }
    }
    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_payload_hardcodes_model_and_size() {
        let body = PublicImageRequest {
            prompt: "a hot air balloon".to_string(),
            source_url: None,
        };
        let payload = build_public_image_payload(&body);
        assert_eq!(payload["model"], PUBLIC_IMAGE_MODEL);
        assert_eq!(payload["size"], PUBLIC_IMAGE_SIZE);
        assert_eq!(payload["prompt"], "a hot air balloon");
        assert!(payload.get("images").is_none());
    }

    #[test]
    fn build_payload_threads_source_url_through() {
        let body = PublicImageRequest {
            prompt: "stylise this".to_string(),
            source_url: Some("https://cdn.example.com/seed.png".to_string()),
        };
        let payload = build_public_image_payload(&body);
        assert_eq!(payload["images"][0], "https://cdn.example.com/seed.png");
    }
}
