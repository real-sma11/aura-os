//! Shared upstream-proxy plumbing for the public-mode generation
//! endpoints (image / video / model3d).
//!
//! The three handlers (`handlers/public/{image,video,model3d}.rs`)
//! all funnel through this single core so the rate-limit-gate +
//! upstream-call + SSE-shape concerns live in one place. Each
//! handler stays a thin orchestrator that:
//!
//! 1. Validates its own request body (DTO defines only the fields a
//!    public caller may send — everything else is hardcoded
//!    server-side per the plan's cost-control mandate).
//! 2. Reserves a turn slot via [`super::enforce_public_turn`].
//! 3. Calls [`proxy_public_generation_stream`] with the fixed
//!    upstream payload and modality.
//!
//! The upstream router (`aura-router /v1/generate-*/stream`)
//! returns SSE frames that the auth'd siblings already normalize
//! into the canonical event names the chat-ui renders
//! (`generation_start`, `generation_progress`,
//! `generation_partial_image`, `generation_completed`,
//! `generation_error`). The same normalization is reproduced here
//! so the frontend's existing media-rendering code works unchanged
//! for public users — we cannot reach into
//! `handlers/generation/`'s `pub(super)` helpers from this module
//! (and Phase 3 must not modify the auth'd generation files), so
//! the helpers are duplicated.
//!
//! Module layout (split from a previously single 599-line file to
//! satisfy the rules-rust 500-line cap):
//!
//! - [`request`] — header helpers + [`PublicGenerationCall`] +
//!   the upstream POST shape ([`PUBLIC_GENERATION_OPEN_TIMEOUT`],
//!   [`map_upstream_status_failure`]).
//! - [`relay`] — SSE relay state machine: drains the upstream byte
//!   stream, translates router frames onto the canonical
//!   `generation_*` events, and appends the trailing `limit` frame.
//! - [`completed`] — alias-promotion for `generation_completed`
//!   payloads + the error-frame normaliser.

mod completed;
mod relay;
mod request;

pub(crate) use request::{
    bearer_token_from_headers, caller_ip_from_headers, PublicGenerationCall, PublicGenerationSse,
};

use axum::response::sse::{KeepAlive, Sse};
use tokio::time::timeout;
use tracing::{error, info, warn};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::demo_agent::SYSTEM_DEMO_USER_ID;
use super::gate::TurnGuard;

use relay::build_public_generation_sse;
use request::{map_upstream_status_failure, PUBLIC_GENERATION_OPEN_TIMEOUT};

/// Authenticate + open the upstream proxy stream and wrap the
/// resulting byte stream as an SSE response. On stream completion
/// the canonical `{ kind: "limit", ... }` frame is appended so the
/// frontend mounts the upgrade modal deterministically — matching
/// the phase-2 chat handler's contract.
pub(crate) async fn proxy_public_generation_stream(
    state: &AppState,
    bearer_token: &str,
    call: PublicGenerationCall,
    guard: TurnGuard,
) -> ApiResult<Sse<PublicGenerationSse>> {
    let generation_id = uuid::Uuid::new_v4().to_string();
    let modality = call.modality;
    let url = format!("{}{}", state.router_url, call.upstream_path);
    info!(
        generation_id = %generation_id,
        modality = modality.as_str(),
        guest_id = %guard.guest_id,
        turn_count = guard.turn_count(),
        "public_generation: opening upstream proxy"
    );

    let client = reqwest::Client::new();
    let response = timeout(
        PUBLIC_GENERATION_OPEN_TIMEOUT,
        client
            .post(&url)
            .bearer_auth(bearer_token)
            .header("X-Aura-Agent-Id", format!("public-{}", &generation_id))
            .header("X-Aura-User-Id", SYSTEM_DEMO_USER_ID)
            .header("X-Aura-Session-Id", &generation_id)
            .json(&call.payload)
            .send(),
    )
    .await
    .map_err(|_| {
        warn!(
            generation_id = %generation_id,
            modality = modality.as_str(),
            "public_generation: upstream open timed out"
        );
        ApiError::service_unavailable("public generation is taking too long to start")
    })?
    .map_err(|err| {
        error!(
            generation_id = %generation_id,
            modality = modality.as_str(),
            error = %err,
            "public_generation: upstream request failed"
        );
        ApiError::bad_gateway(format!("upstream request failed: {err}"))
    })?;

    if !response.status().is_success() {
        return Err(map_upstream_status_failure(response).await);
    }

    let bytes = response.bytes_stream();
    let stream = build_public_generation_sse(bytes, generation_id, guard, modality);
    let boxed: PublicGenerationSse = Box::pin(stream);
    Ok(Sse::new(boxed).keep_alive(KeepAlive::default()))
}
