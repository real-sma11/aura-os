//! Public-mode rate-limit gate exposed to phase-2 chat / image / video /
//! model3d handlers. The handlers obtain a [`TurnGuard`] *before* any
//! `.await` on the upstream router proxy, so a failing upstream call
//! cannot let the same guest retry for free — the slot was already
//! consumed.
//!
//! Module surface:
//!
//! - [`PublicGateCtx`] — single argument bundle that keeps the
//!   per-call parameter count under the rules-rust 5-param ceiling.
//! - [`enforce_public_turn`] — sync wrapper around
//!   [`super::rate_limiter::RateLimiter::try_reserve`] returning a
//!   [`TurnGuard`] on success and the typed
//!   [`crate::error::ApiError::public_limit_reached`] on any cap
//!   trip.
//! - [`record_completion`] — explicit no-op marker so call sites
//!   stay self-documenting ("turn finished, drop the guard").
//! - [`emit_limit_frame`] — phase-2 SSE helper that serialises the
//!   final `{ kind: "limit", … }` frame the frontend uses to mount
//!   the upgrade modal.

use std::net::IpAddr;

use serde::Serialize;
use tracing::warn;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::rate_limiter::RateLimitError;
use super::types::{GuestClaims, GuestId, IpHash, PublicModality, PublicTurnCount};

/// Single argument bundle threaded through every public-mode turn
/// guard. Carries the four pieces of state the limiter needs without
/// pushing the call shape over the rules-rust 5-parameter ceiling.
///
/// Borrow-only; the caller owns the [`AppState`] clone and the
/// [`GuestClaims`] (which itself was borrowed from the
/// `AuthGuestJwt` extractor).
pub(crate) struct PublicGateCtx<'a> {
    /// Process-wide app state — pulled in for `state.public_rate_limiter`
    /// and any future tracing fields the gate might want.
    pub(crate) state: &'a AppState,
    /// Decoded guest token from the [`crate::state::AuthGuestJwt`]
    /// extractor.
    pub(crate) claims: &'a GuestClaims,
    /// Caller IP, hashed by the gate before it enters the limiter
    /// map. Never logged in raw form.
    pub(crate) ip: IpAddr,
    /// Modality the turn is targeting. Used purely for tracing in
    /// phase 1; phase 2 / 3 handlers branch on this to pick the
    /// upstream router proxy.
    pub(crate) modality: PublicModality,
}

/// RAII handle for a successfully-reserved public turn slot.
///
/// The slot is consumed by [`enforce_public_turn`] *before* the
/// returned guard is constructed, so failed downstream calls cannot
/// retry without burning another slot. Dropping the guard is a
/// no-op — the limiter never decrements — by design.
///
/// Holds the per-turn counter for inclusion in the
/// `{ kind: "limit", turn_count }` SSE frame phase-2 emits at end of
/// stream, plus the [`GuestId`] and [`PublicModality`] for tracing.
#[derive(Debug)]
pub(crate) struct TurnGuard {
    pub(crate) guest_id: GuestId,
    pub(crate) turn_count: PublicTurnCount,
    pub(crate) modality: PublicModality,
}

impl TurnGuard {
    /// Numeric turn count after this slot was reserved (1, 2, or 3
    /// for the standard 3-turn cap). Convenience accessor so the
    /// phase-2 chat handler doesn't have to reach into
    /// [`PublicTurnCount::get`] directly.
    pub(crate) fn turn_count(&self) -> u32 {
        self.turn_count.get()
    }
}

/// Reserve a public-turn slot for `ctx`. On success the returned
/// [`TurnGuard`] carries the post-increment turn count for inclusion
/// in the streamed `limit` frame. On any limiter cap trip — per-guest
/// or per-IP — returns the typed
/// [`crate::error::ApiError::public_limit_reached`] (HTTP 429).
///
/// Failure mode: the limiter increments BEFORE this function returns
/// success, so a downstream router-proxy failure cannot let the same
/// guest retry for free. This matches the plan's
/// "lock-then-clone-then-drop" / "consume slot before await" rule.
pub(crate) fn enforce_public_turn(ctx: &PublicGateCtx<'_>) -> ApiResult<TurnGuard> {
    let guest_id = ctx.claims.guest_id();
    let ip_hash = IpHash::from_ip(ctx.ip);
    match ctx
        .state
        .public_rate_limiter
        .try_reserve(&guest_id, ip_hash)
    {
        Ok(turn_count) => Ok(TurnGuard {
            guest_id,
            turn_count,
            modality: ctx.modality,
        }),
        Err(RateLimitError::Guest { limit }) => {
            warn!(
                guest_id = %guest_id,
                ip_hash = %ip_hash.to_hex(),
                modality = ctx.modality.as_str(),
                limit,
                "public turn rejected: per-guest cap reached"
            );
            Err(ApiError::public_limit_reached(limit))
        }
        Err(RateLimitError::Ip { limit }) => {
            warn!(
                guest_id = %guest_id,
                ip_hash = %ip_hash.to_hex(),
                modality = ctx.modality.as_str(),
                limit,
                "public turn rejected: per-IP daily ceiling reached"
            );
            Err(ApiError::public_limit_reached(limit))
        }
        Err(RateLimitError::Global { limit }) => {
            warn!(
                guest_id = %guest_id,
                modality = ctx.modality.as_str(),
                limit,
                "public turn rejected: global daily ceiling reached"
            );
            Err(ApiError::public_limit_reached(limit))
        }
    }
}

/// Explicit no-op marker run from the phase-2 stream sentinel after
/// a turn terminates cleanly. Documenting "turn done" at the call
/// site keeps the lifecycle obvious without giving the limiter any
/// rollback semantics — the slot stays consumed.
pub(crate) fn record_completion(guard: TurnGuard) {
    // Drop intentionally; this function exists so callers say
    // `record_completion(guard)` rather than `let _ = guard;`.
    drop(guard);
}

/// Wire shape of the final SSE frame phase-2 chat handlers append
/// after every public turn. The frontend uses `kind: "limit"` to
/// mount the non-dismissable upgrade modal once `turn_count == limit`.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct LimitFrame {
    pub(crate) kind: &'static str,
    pub(crate) turn_count: u32,
    pub(crate) limit: u32,
}

/// Build the JSON-serializable `limit` frame the phase-2 chat handler
/// appends as the final SSE event. Held here so the chat / image /
/// video / model3d handlers all emit the same frame shape.
pub(crate) fn emit_limit_frame(turn_count: u32) -> LimitFrame {
    LimitFrame {
        kind: "limit",
        turn_count,
        limit: super::rate_limiter::PUBLIC_TURN_LIMIT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn limit_frame_uses_canonical_limit_constant() {
        let frame = emit_limit_frame(2);
        assert_eq!(frame.kind, "limit");
        assert_eq!(frame.turn_count, 2);
        assert_eq!(frame.limit, super::super::rate_limiter::PUBLIC_TURN_LIMIT);
    }

    #[test]
    fn limit_frame_serialises_to_expected_json_shape() {
        let frame = emit_limit_frame(3);
        let json = serde_json::to_value(&frame).expect("serialise limit frame");
        assert_eq!(json["kind"], "limit");
        assert_eq!(json["turn_count"], 3);
        assert_eq!(
            json["limit"],
            serde_json::Value::from(super::super::rate_limiter::PUBLIC_TURN_LIMIT),
        );
    }

    #[test]
    fn turn_guard_exposes_post_increment_count() {
        let guard = TurnGuard {
            guest_id: GuestId("g-1".to_string()),
            turn_count: PublicTurnCount(2),
            modality: PublicModality::Chat,
        };
        assert_eq!(guard.turn_count(), 2);
        record_completion(guard);
    }

    #[test]
    fn ip_hash_round_trips_for_canonical_localhost() {
        let hex = IpHash::from_ip(IpAddr::V4(Ipv4Addr::LOCALHOST)).to_hex();
        assert_eq!(hex.len(), 32, "16 bytes hex-encoded");
    }
}
