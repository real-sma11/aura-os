//! Process-wide stability counters owned by aura-os-harness.
//!
//! Phase 5 of the agent-stream reliability plan adds in-process
//! observability for the WebSocket bridge and the harness initial
//! connect retry loop. Both live in this crate, so we expose simple
//! lock-free counters here that aura-os-server reads at snapshot time
//! through `aura_os_harness::stability_metrics::*` accessors.
//!
//! The counters intentionally use `Ordering::Relaxed`: hot-path
//! increments do not synchronise with any other shared state, and the
//! snapshot read in `/api/admin/health` only needs eventual
//! consistency — the operator-visible counts are advisory, not
//! load-bearing for any control flow.
//!
//! Keeping the counters as static `AtomicU64`s rather than threading a
//! `BridgeMetricsSink` trait through `spawn_ws_bridge` is the cleaner
//! option for ws_bridge as it stands today: the bridge has no other
//! reason to know about the server's `AppState`, the call sites are
//! single-line increments, and the static keeps test setup zero-cost
//! for both crates.

use std::sync::atomic::{AtomicU64, Ordering};

static HARNESS_INITIAL_CONNECT_RETRIES: AtomicU64 = AtomicU64::new(0);
static HARNESS_WS_CLOSED: AtomicU64 = AtomicU64::new(0);
static HARNESS_WS_READ_ERROR: AtomicU64 = AtomicU64::new(0);
static HARNESS_PROTOCOL_MISMATCH: AtomicU64 = AtomicU64::new(0);

/// Bumped once per *retry* attempt past the first inside
/// `LocalHarness::open_session` / `SwarmHarness::open_session_socket`.
/// The first attempt is not counted; the second / third attempts that
/// the Phase 2 retry loop schedules are.
pub fn inc_initial_connect_retry() {
    HARNESS_INITIAL_CONNECT_RETRIES.fetch_add(1, Ordering::Relaxed);
}

/// Bumped when the harness WebSocket reader observes a `Close` frame
/// and emits the synthetic `harness_ws_closed` bridge error.
pub fn inc_ws_closed() {
    HARNESS_WS_CLOSED.fetch_add(1, Ordering::Relaxed);
}

/// Bumped when the harness WebSocket reader bails on a tungstenite
/// `Err` and emits the synthetic `harness_ws_read_error` bridge error.
pub fn inc_ws_read_error() {
    HARNESS_WS_READ_ERROR.fetch_add(1, Ordering::Relaxed);
}

/// Bumped when the harness reader receives a frame that fails to
/// parse as either a typed `OutboundMessage` or a fallback JSON value
/// — i.e. the canonical `harness_protocol_mismatch` bridge error.
pub fn inc_protocol_mismatch() {
    HARNESS_PROTOCOL_MISMATCH.fetch_add(1, Ordering::Relaxed);
}

#[must_use]
pub fn initial_connect_retries() -> u64 {
    HARNESS_INITIAL_CONNECT_RETRIES.load(Ordering::Relaxed)
}

#[must_use]
pub fn ws_closed() -> u64 {
    HARNESS_WS_CLOSED.load(Ordering::Relaxed)
}

#[must_use]
pub fn ws_read_error() -> u64 {
    HARNESS_WS_READ_ERROR.load(Ordering::Relaxed)
}

#[must_use]
pub fn protocol_mismatch() -> u64 {
    HARNESS_PROTOCOL_MISMATCH.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each `inc_*` must bump its own counter without touching the
    /// others. Read snapshots before/after to keep the test agnostic
    /// to other tests' contributions in the same process.
    #[test]
    fn inc_methods_only_bump_their_own_counter() {
        let before_retries = initial_connect_retries();
        let before_closed = ws_closed();
        let before_read_error = ws_read_error();
        let before_proto = protocol_mismatch();

        inc_initial_connect_retry();
        inc_ws_closed();
        inc_ws_read_error();
        inc_protocol_mismatch();

        assert_eq!(initial_connect_retries(), before_retries + 1);
        assert_eq!(ws_closed(), before_closed + 1);
        assert_eq!(ws_read_error(), before_read_error + 1);
        assert_eq!(protocol_mismatch(), before_proto + 1);
    }
}
