//! `POST /api/public/generation/video` — anonymous video-mode SSE
//! handler.
//!
//! Phase 3 mirror of [`crate::handlers::generation::generate_video_stream`].
//! Same SSE shape (forwarded via
//! [`super::generation_common::proxy_public_generation_stream`]) so
//! the chat-ui's video-rendering code paths work for public users
//! unchanged. Differences from the auth'd sibling:
//!
//! - Authenticates with [`AuthGuestJwt`] instead of
//!   [`crate::state::AuthJwt`] / [`crate::state::AuthSession`].
//! - Gated through [`super::enforce_public_turn`] before the
//!   upstream open, so a failed downstream proxy cannot let the
//!   same guest retry for free.
//! - The DTO ([`PublicVideoRequest`]) accepts only the prompt — the
//!   server stamps in the cheapest Veo tier and shortest supported
//!   duration before forwarding.
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

use crate::error::ApiResult;
use crate::state::{AppState, AuthGuestJwt};

use super::gate::{enforce_public_turn, PublicGateCtx};
use super::generation_common::{
    bearer_token_from_headers, caller_ip_from_headers, proxy_public_generation_stream,
    PublicGenerationCall, PublicGenerationSse,
};
use super::types::PublicModality;

/// Cheapest Veo tier from `VIDEO_MODELS` in
/// [interface/src/constants/models.ts]. "Lite" is documented in the
/// model registry as the smallest-credit Veo variant and is hardcoded
/// here so the public surface stays bounded — clients can never bump
/// up to "Standard" or "Fast" without signing in.
const PUBLIC_VIDEO_MODEL: &str = "veo-3.1-lite-generate-preview";

/// Shortest duration supported by the cheap Veo tier. Mirrors the
/// `[4, 6, 8]` 720p option set in `AuraVideoMainPanel`; the public
/// surface always picks the minimum.
const PUBLIC_VIDEO_DURATION_SECONDS: u8 = 4;

/// Default resolution paired with the cheap tier. Both are tied
/// together because Seedance accepts other resolutions but only the
/// Veo "lite" preview is offered to public callers.
const PUBLIC_VIDEO_RESOLUTION: &str = "720p";

/// Default aspect ratio. Lined up with the logged-in `AuraVideoStore`
/// boot defaults so a public-mode demo matches the auth'd surface
/// look-and-feel.
const PUBLIC_VIDEO_ASPECT_RATIO: &str = "16:9";

/// Public-mode video generation request. The DTO carries only the
/// prompt — every other knob is server-fixed.
#[derive(Debug, Deserialize)]
pub(crate) struct PublicVideoRequest {
    pub(crate) prompt: String,
}

/// `POST /api/public/generation/video`. Reserves a turn slot via the
/// shared gate and forwards a fixed-payload upstream call.
pub(crate) async fn public_video_stream(
    State(state): State<AppState>,
    AuthGuestJwt(claims): AuthGuestJwt,
    headers: HeaderMap,
    Json(body): Json<PublicVideoRequest>,
) -> ApiResult<Sse<PublicGenerationSse>> {
    let ip = caller_ip_from_headers(&headers);
    let guard = enforce_public_turn(&PublicGateCtx {
        state: &state,
        claims: &claims,
        ip,
        modality: PublicModality::Video,
    })?;
    info!(
        guest_id = %claims.guest_id(),
        modality = PublicModality::Video.as_str(),
        turn_count = guard.turn_count(),
        "public_video: turn accepted"
    );
    let payload = build_public_video_payload(&body);
    let bearer_token = bearer_token_from_headers(&headers).unwrap_or_default();
    proxy_public_generation_stream(
        &state,
        &bearer_token,
        PublicGenerationCall {
            upstream_path: "/v1/generate-video/stream",
            payload,
            modality: PublicModality::Video,
        },
        guard,
    )
    .await
}

/// Build the upstream router payload for a public video turn. Only
/// the caller's prompt flows through; the model, duration,
/// resolution, and aspect ratio are pinned to the cheap defaults.
fn build_public_video_payload(body: &PublicVideoRequest) -> Value {
    json!({
        "prompt": body.prompt,
        "model": PUBLIC_VIDEO_MODEL,
        "durationSeconds": PUBLIC_VIDEO_DURATION_SECONDS,
        "resolution": PUBLIC_VIDEO_RESOLUTION,
        "aspectRatio": PUBLIC_VIDEO_ASPECT_RATIO,
        "generateAudio": false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_payload_hardcodes_cheap_tier_and_duration() {
        let body = PublicVideoRequest {
            prompt: "a kite over a beach".to_string(),
        };
        let payload = build_public_video_payload(&body);
        assert_eq!(payload["model"], PUBLIC_VIDEO_MODEL);
        assert_eq!(payload["durationSeconds"], 4);
        assert_eq!(payload["resolution"], PUBLIC_VIDEO_RESOLUTION);
        assert_eq!(payload["aspectRatio"], PUBLIC_VIDEO_ASPECT_RATIO);
        assert_eq!(payload["generateAudio"], false);
    }

    #[test]
    fn build_payload_carries_prompt_unchanged() {
        let body = PublicVideoRequest {
            prompt: "verbatim".to_string(),
        };
        let payload = build_public_video_payload(&body);
        assert_eq!(payload["prompt"], "verbatim");
    }
}
