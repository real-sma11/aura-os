//! `POST /api/public/generation/model3d` — anonymous 3D-mode SSE
//! handler.
//!
//! Phase 3 mirror of [`crate::handlers::generation::generate_3d_stream`].
//! Same SSE shape (forwarded via
//! [`super::generation_common::proxy_public_generation_stream`]) so
//! the chat-ui's model-rendering code paths work for public users
//! unchanged. Differences from the auth'd sibling:
//!
//! - Authenticates with [`AuthGuestJwt`] instead of
//!   [`crate::state::AuthJwt`] / [`crate::state::AuthSession`].
//! - Gated through [`super::enforce_public_turn`] before the
//!   upstream open.
//! - The DTO ([`PublicModel3dRequest`]) accepts only an
//!   `image_url`-or-`image_data` source plus an optional prompt — no
//!   quality / model knobs. Tripo is the only provider exposed today
//!   so there is no model field to omit; the upstream payload is
//!   intentionally minimal.
//! - `persist = None`: no per-user history write.
//! - No billing preflight: the per-guest 3-turn cap + per-IP daily
//!   ceiling are the only cost guards.

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::Sse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthGuestJwt};

use super::gate::{enforce_public_turn, PublicGateCtx};
use super::generation_common::{
    bearer_token_from_headers, caller_ip_from_headers, proxy_public_generation_stream,
    PublicGenerationCall, PublicGenerationSse,
};
use super::types::PublicModality;

/// Public-mode 3D generation request. Carries either a fully-resolved
/// `image_url` (preferred — small over-the-wire) or a base64
/// `image_data` URL the caller pasted into the input bar. Both reduce
/// to a single `image_url` string forwarded to the upstream router
/// for consistency with the auth'd sibling.
#[derive(Debug, Deserialize)]
pub(crate) struct PublicModel3dRequest {
    #[serde(default, alias = "imageUrl")]
    pub(crate) image_url: Option<String>,
    #[serde(default, alias = "imageData")]
    pub(crate) image_data: Option<String>,
    #[serde(default)]
    pub(crate) prompt: Option<String>,
}

/// `POST /api/public/generation/model3d`. Reserves a turn slot via
/// the shared gate and forwards a fixed-payload upstream call.
pub(crate) async fn public_model3d_stream(
    State(state): State<AppState>,
    AuthGuestJwt(claims): AuthGuestJwt,
    headers: HeaderMap,
    Json(body): Json<PublicModel3dRequest>,
) -> ApiResult<Sse<PublicGenerationSse>> {
    let image_url = require_source_image(&body)?;
    let ip = caller_ip_from_headers(&headers);
    let guard = enforce_public_turn(&PublicGateCtx {
        state: &state,
        claims: &claims,
        ip,
        modality: PublicModality::Model3d,
    })?;
    info!(
        guest_id = %claims.guest_id(),
        modality = PublicModality::Model3d.as_str(),
        turn_count = guard.turn_count(),
        "public_model3d: turn accepted"
    );
    let payload = build_public_model3d_payload(&image_url, body.prompt.as_deref());
    let bearer_token = bearer_token_from_headers(&headers).unwrap_or_default();
    proxy_public_generation_stream(
        &state,
        &bearer_token,
        PublicGenerationCall {
            upstream_path: "/v1/generate-3d/stream",
            payload,
            modality: PublicModality::Model3d,
        },
        guard,
    )
    .await
}

/// Resolve the source image. Mirrors the auth'd handler's
/// "exactly one of `image_url` / `image_data`" contract; rejecting
/// upfront keeps the failure shape consistent and the gate untouched
/// for invalid requests (so the user does not lose a turn slot when
/// the payload was malformed in the first place).
fn require_source_image(body: &PublicModel3dRequest) -> ApiResult<String> {
    let url = body
        .image_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            body.image_data
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
        })
        .ok_or_else(|| ApiError::bad_request("either `image_url` or `image_data` is required"))?;
    Ok(url.to_string())
}

/// Build the upstream router payload for a public 3D turn. No model
/// or quality knob is exposed; the auth'd sibling already runs Tripo
/// at the default tier and we follow suit.
fn build_public_model3d_payload(image_url: &str, prompt: Option<&str>) -> Value {
    let mut payload = json!({
        "imageUrl": image_url,
    });
    if let Some(prompt) = prompt {
        let trimmed = prompt.trim();
        if !trimmed.is_empty() {
            payload["prompt"] = json!(trimmed);
        }
    }
    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_source_image_rejects_empty_body() {
        let body = PublicModel3dRequest {
            image_url: None,
            image_data: None,
            prompt: None,
        };
        assert!(require_source_image(&body).is_err());
    }

    #[test]
    fn require_source_image_prefers_image_url() {
        let body = PublicModel3dRequest {
            image_url: Some("https://cdn.example.com/seed.png".to_string()),
            image_data: Some("data:image/png;base64,AAA".to_string()),
            prompt: None,
        };
        assert_eq!(
            require_source_image(&body).expect("image_url branch"),
            "https://cdn.example.com/seed.png"
        );
    }

    #[test]
    fn require_source_image_falls_back_to_image_data() {
        let body = PublicModel3dRequest {
            image_url: Some("   ".to_string()),
            image_data: Some("data:image/png;base64,AAA".to_string()),
            prompt: None,
        };
        assert_eq!(
            require_source_image(&body).expect("image_data branch"),
            "data:image/png;base64,AAA"
        );
    }

    #[test]
    fn build_payload_omits_blank_prompt() {
        let payload = build_public_model3d_payload("https://cdn.example.com/seed.png", Some("   "));
        assert!(payload.get("prompt").is_none());
        assert_eq!(payload["imageUrl"], "https://cdn.example.com/seed.png");
    }
}
