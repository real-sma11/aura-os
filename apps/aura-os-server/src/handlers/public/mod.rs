//! Public (anonymous) endpoint family.
//!
//! Phase 1 (Foundations) introduces the auth + rate-limit plumbing the
//! later-phase handlers (chat, image, video, model3d) all sit on top
//! of. Nothing in this module is mounted on the router yet — the
//! `router/public.rs` wiring lands in Phase 2, which is also when the
//! `dead_code` and `unused_imports` allows below stop being
//! load-bearing (every re-export has a phase-2 / phase-3 consumer
//! queued up).
//!
//! Module layout:
//!
//! - [`types`] — shared newtypes ([`GuestId`], [`PublicTurnCount`],
//!   [`IpHash`], [`PublicModality`]) plus the [`GuestClaims`] payload
//!   the [`crate::state::AuthGuestJwt`] extractor decodes from the
//!   bearer token.
//! - [`rate_limiter`] — process-wide [`RateLimiter`] keyed on
//!   `(GuestId, IpHash)` with lazy 24h eviction and a [`Clock`]
//!   abstraction so tests can pin "now".
//! - [`gate`] — the public-facing surface used by phase-2 handlers
//!   ([`enforce_public_turn`], [`record_completion`], [`emit_limit_frame`])
//!   plus the [`PublicGateCtx`] container that keeps the call shape
//!   under the 5-parameter ceiling.
//! - [`demo_agent`] — lazy provisioning of the system-owned
//!   [`AgentId`](aura_os_core::AgentId) every public chat turn targets.

// Phase 1 lays the plumbing the phase-2 router-mounted handlers all
// sit on top of. Until those handlers land the re-exports below have
// no in-crate consumers, so we relax `dead_code` / `unused_imports`
// at the module level rather than papering each item with a
// per-attribute allow that the phase-2 PR would have to scrub.
#![allow(dead_code, unused_imports)]

pub(crate) mod demo_agent;
pub(crate) mod gate;
pub(crate) mod jwt;
pub(crate) mod rate_limiter;
pub(crate) mod types;

pub(crate) use demo_agent::{ensure_public_demo_agent, public_demo_agent_id, SYSTEM_DEMO_USER_ID};
pub(crate) use gate::{
    emit_limit_frame, enforce_public_turn, record_completion, PublicGateCtx, TurnGuard,
};
pub(crate) use jwt::{decode_guest_token, extract_bearer_from_headers, is_guest_token};
pub use rate_limiter::RateLimiter;
pub(crate) use rate_limiter::{Clock, SystemClock, PUBLIC_IP_DAILY_CEILING, PUBLIC_TURN_LIMIT};
pub(crate) use types::{GuestClaims, GuestId, IpHash, PublicModality, PublicTurnCount};
