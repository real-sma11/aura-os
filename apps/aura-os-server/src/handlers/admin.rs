//! Admin diagnostic endpoints.
//!
//! Currently exposes a single `/api/admin/health` GET that returns a
//! JSON snapshot of the in-process Phase 5 stability counters, together
//! with the resolved runtime configuration and live aggregate counts
//! the operator needs to triage a stuck server. Auth gating is the
//! same `protected_api_router` middleware every other admin/debug
//! route uses (`crate::auth_guard::require_verified_session`) — there
//! is no separate admin-token concept yet, so any verified session
//! can read the snapshot.
//!
//! The endpoint is intentionally hand-rolled JSON (`serde_json::Value`)
//! rather than a typed response so the field set can grow over time
//! without new dashboards needing a corresponding Rust release. Field
//! ordering inside `metrics` is pinned by the
//! [`crate::stability_metrics::StabilityMetricsSnapshot`] derive.

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use serde_json::Value;

use crate::handlers::agents::chat::max_pending_turns;
use crate::state::AppState;

/// Wire shape of the `/api/admin/health` response. Held as a typed
/// struct so the snapshot can be exercised by a unit test without
/// having to compare loose `serde_json::Value` trees, but encoded
/// untagged so the JSON keys read naturally to an operator.
///
/// Field order matches the JSON the dashboard renders top-down:
/// uptime / version first (the "is it running" bar), then the metrics
/// snapshot (the "is it healthy" graphs), then the live aggregate
/// counts (the "what's it doing right now" gauges), then the resolved
/// `config` (the "what env did it actually pick up" footer).
#[derive(Debug, Serialize)]
pub(crate) struct AdminHealthResponse {
    /// Seconds since `build_app_state` captured `started_at`. Computed
    /// at request time so it monotonically increases between
    /// snapshots.
    pub uptime_seconds: u64,
    /// `CARGO_PKG_VERSION` of the `aura-os-server` crate the binary
    /// was built from. Surfaces in the JSON so an operator can spot
    /// "snapshot is from the old binary" against the deployed
    /// version.
    pub version: &'static str,
    /// Owned snapshot of every stability counter (server-owned plus
    /// the four harness-owned static counters joined in via
    /// `stability_metrics::StabilityMetrics::snapshot`).
    pub metrics: crate::stability_metrics::StabilityMetricsSnapshot,
    /// Number of live `ChatSession` entries in the dashmap
    /// (`(session_key, model)` keyed). Reads `len()` directly — no
    /// alive-filter — because the registry self-evicts dead entries
    /// on the next `try_reuse_session` so transient ghosts here are
    /// at most one turn old.
    pub active_chat_sessions: u64,
    /// Number of live `ActiveAutomaton` entries in the registry.
    /// Counted under the registry mutex to avoid the (rare) torn read
    /// against an in-flight `start_loop` insert; the lock is held for
    /// a single `HashMap::len()` call.
    pub active_automatons: u64,
    /// Resolved per-process WS slot cap fed from
    /// `state.harness_ws_slots`.
    pub harness_ws_slots_cap: usize,
    /// Resolved env-driven config the binary actually picked up at
    /// boot. Lets an operator confirm that an env-var change took
    /// effect without grepping startup logs.
    pub config: AdminHealthConfig,
}

/// Resolved env-driven config block for `AdminHealthResponse.config`.
/// Values are captured at request time from the live `AppState`, not
/// re-read from the environment, so a mid-process env mutation cannot
/// race the snapshot against the actual values the running code uses.
#[derive(Debug, Serialize)]
pub(crate) struct AdminHealthConfig {
    /// `state.turn_first_event_timeout` in whole seconds.
    pub turn_first_event_timeout_secs: u64,
    /// `state.turn_max_idle_timeout` in whole seconds. The
    /// sliding-idle ceiling Phase 1.1 introduced.
    pub turn_max_idle_timeout_secs: u64,
    /// `state.chat_auto_fork_threshold` (0.0..=1.0). Surfacing this
    /// here is the operator-visible signal that the configured
    /// `AURA_CHAT_AUTO_FORK_THRESHOLD` env override took effect.
    pub auto_fork_threshold: f64,
    /// `max_pending_turns()` resolved from
    /// `AURA_PARTITION_TURN_QUEUE`.
    pub partition_turn_queue: usize,
    /// `state.harness_broadcast_capacity` resolved from
    /// `AURA_HARNESS_BROADCAST_CAPACITY` at `build_app_state` time.
    pub harness_broadcast_capacity: usize,
}

/// `GET /api/admin/health` handler. Builds an `AdminHealthResponse`
/// from the live `AppState` and returns it as JSON.
///
/// Implementation notes:
/// * `uptime_seconds` uses `Instant::saturating_duration_since` so a
///   monotonic-clock anomaly never panics the handler.
/// * `active_chat_sessions` reads `DashMap::len()` (lock-free).
/// * `active_automatons` briefly takes the registry mutex; the lock
///   is held only for a single `HashMap::len()` call so it cannot
///   block any chat turn for a measurable amount of time.
pub(crate) async fn get_admin_health(State(state): State<AppState>) -> Json<Value> {
    let uptime_seconds = std::time::Instant::now()
        .saturating_duration_since(state.started_at)
        .as_secs();
    let active_chat_sessions = state.chat_sessions.len() as u64;
    let active_automatons = {
        let reg = state.automaton_registry.lock().await;
        reg.len() as u64
    };
    let resp = AdminHealthResponse {
        uptime_seconds,
        version: env!("CARGO_PKG_VERSION"),
        metrics: state.stability_metrics.snapshot(),
        active_chat_sessions,
        active_automatons,
        harness_ws_slots_cap: state.harness_ws_slots,
        config: AdminHealthConfig {
            turn_first_event_timeout_secs: state.turn_first_event_timeout.as_secs(),
            turn_max_idle_timeout_secs: state.turn_max_idle_timeout.as_secs(),
            auto_fork_threshold: state.chat_auto_fork_threshold,
            partition_turn_queue: max_pending_turns(),
            harness_broadcast_capacity: state.harness_broadcast_capacity,
        },
    };
    Json(serde_json::to_value(&resp).unwrap_or_else(|_| serde_json::json!({})))
}
