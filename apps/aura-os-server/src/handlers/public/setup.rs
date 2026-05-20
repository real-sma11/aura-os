//! `POST /api/public/setup` — issues a guest JWT and reports the live
//! per-guest turn count.
//!
//! Phase 2 entry point for the public-mode surface. The handler is
//! stateless aside from minting a fresh [`GuestId`] (ulid) and
//! signing a guest-role JWT via [`jwt::encode_guest_token`]. The
//! returned `turn_count` is always `0` for a freshly minted guest
//! id, but the field is part of the contract so a future refresh
//! flow (re-using an existing client-stored guest id) can return
//! the current bucket count without re-deriving it on the client.

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use tracing::{info, warn};
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::jwt::encode_guest_token;
use super::rate_limiter::PUBLIC_TURN_LIMIT;
use super::types::GuestId;

/// Response body for [`public_setup`].
///
/// Fields mirror the spec: `token` is the short-lived guest JWT the
/// client stamps onto every `/api/public/*` call; `turn_count` is
/// the live limiter bucket size for the issued guest id (0 for fresh
/// ids); `limit` is the canonical 3-turn cap surfaced so the client
/// never has to hardcode it.
#[derive(Debug, Serialize)]
pub(crate) struct PublicSetupResponse {
    pub token: String,
    pub turn_count: u32,
    pub limit: u32,
}

/// Mint a guest id, sign a guest JWT, and report the live bucket
/// count. Failures during signing surface as a 5xx — the
/// `jsonwebtoken` crate will only fail on a broken clock or an
/// impossibly short signing secret, both of which are deployment
/// bugs the operator needs to see.
pub(crate) async fn public_setup(
    State(state): State<AppState>,
) -> ApiResult<Json<PublicSetupResponse>> {
    let guest_id = mint_guest_id();
    let (token, _claims) = encode_guest_token(&guest_id).map_err(|err| {
        warn!(
            error = %err,
            "public_setup: failed to mint guest token"
        );
        ApiError::internal("failed to mint guest token")
    })?;
    let turn_count = state
        .public_rate_limiter
        .current_turn_count(&guest_id)
        .get();
    info!(
        guest_id = %guest_id,
        turn_count,
        "public_setup: issued guest token"
    );
    Ok(Json(PublicSetupResponse {
        token,
        turn_count,
        limit: PUBLIC_TURN_LIMIT,
    }))
}

/// Build a fresh [`GuestId`]. Uses a uuid v4 because the rest of the
/// codebase already pulls in `uuid` and avoids adding a `ulid`
/// dependency for the single use site.
fn mint_guest_id() -> GuestId {
    GuestId(Uuid::new_v4().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_guest_id_emits_unique_values() {
        let a = mint_guest_id();
        let b = mint_guest_id();
        assert_ne!(a.as_str(), b.as_str());
        assert!(!a.as_str().is_empty());
    }
}
