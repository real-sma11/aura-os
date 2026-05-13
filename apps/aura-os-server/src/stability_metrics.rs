//! In-process counters that prove the agent-stream reliability work
//! from phases 1-4 is actually firing. Every counter is a lock-free
//! `AtomicU64` so it can be bumped from any hot path (broadcast
//! receiver, watchdog task, persist task, harness retry loop) without
//! competing for a `Mutex`.
//!
//! The struct is held on `AppState` as `Arc<StabilityMetrics>` and
//! exposed read-only through the JSON snapshot returned by
//! `/api/admin/health`. We deliberately do NOT add a Prometheus /
//! StatsD client here — the snapshot endpoint plus the existing
//! `tracing` infrastructure are enough to observe the counters from
//! the Debug app and any operator-visible log scrape.
//!
//! Counter ownership split: the four ws_bridge / harness-retry
//! counters (`harness_ws_closed`, `harness_ws_read_error`,
//! `harness_protocol_mismatch`, `harness_initial_connect_retries`)
//! live as static `AtomicU64`s inside the `aura-os-harness` crate
//! ([`aura_os_harness::stability_metrics`]) — the harness crate has
//! no other reason to know about `AppState`, and threading a
//! `BridgeMetricsSink` trait through `spawn_ws_bridge` for a
//! single-line increment was the wrong shape. The snapshot built
//! here pulls those values via the harness accessors so the
//! `/api/admin/health` JSON exposes a single unified view regardless
//! of which crate owns each counter.
//!
//! Every other counter (turn lifecycle, watchdog firings, broadcast
//! lag, auto-fork bookkeeping, client retry header, busy-queue
//! rejection) is owned by this struct because the hot paths all live
//! inside `aura-os-server` itself.

use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

/// Process-wide reliability counters owned by `aura-os-server`. Every
/// public method increments one counter with `Ordering::Relaxed` —
/// counters are eventually consistent across CPUs but never lost,
/// which is exactly the guarantee a graphable metric needs.
///
/// The four harness-side counters are NOT fields here; see the module
/// docstring for the ownership split.
#[derive(Debug, Default)]
pub struct StabilityMetrics {
    chat_turns_started: AtomicU64,
    chat_turns_completed_ok: AtomicU64,
    stream_stalled: AtomicU64,
    turn_timeout: AtomicU64,
    stream_lagged: AtomicU64,
    agent_busy_queue_full: AtomicU64,
    auto_fork_triggered: AtomicU64,
    auto_fork_applied: AtomicU64,
    client_auto_retry_streamdropped: AtomicU64,
}

/// Owned, `Serialize` snapshot of every counter. Returned by
/// [`StabilityMetrics::snapshot`] and embedded in the
/// `/api/admin/health` JSON body so the Debug UI can graph each
/// counter without holding any reference into the live `AppState`.
///
/// Field order is the public JSON shape — keep it stable. New
/// counters get appended at the end so existing dashboards keep
/// working.
#[derive(Debug, Clone, Serialize)]
pub struct StabilityMetricsSnapshot {
    pub chat_turns_started: u64,
    pub chat_turns_completed_ok: u64,
    pub stream_stalled: u64,
    pub turn_timeout: u64,
    pub stream_lagged: u64,
    pub harness_ws_closed: u64,
    pub harness_ws_read_error: u64,
    pub harness_protocol_mismatch: u64,
    pub harness_initial_connect_retries: u64,
    pub agent_busy_queue_full: u64,
    pub auto_fork_triggered: u64,
    pub auto_fork_applied: u64,
    pub client_auto_retry_streamdropped: u64,
    pub snapshot_at: chrono::DateTime<chrono::Utc>,
}

impl StabilityMetrics {
    /// Build a fresh metrics struct with every server-owned counter
    /// at 0. The harness-owned counters are static globals and are
    /// reset only by restarting the process.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Bumped at the top of `open_harness_chat_stream` when a chat
    /// turn POST is accepted onto the SSE pipeline (after the busy
    /// guard, before the harness send).
    pub fn inc_chat_turns_started(&self) {
        self.chat_turns_started.fetch_add(1, Ordering::Relaxed);
    }

    /// Bumped from the persist task on a clean `AssistantMessageEnd`
    /// — i.e. only when no preceding `Error` event was observed for
    /// the same turn. The gap between this and `chat_turns_started`
    /// is the operator-visible "failed turns" rate.
    pub fn inc_chat_turns_completed_ok(&self) {
        self.chat_turns_completed_ok.fetch_add(1, Ordering::Relaxed);
    }

    /// Bumped when the chat turn watchdog observes the
    /// `FIRST_EVENT_TIMEOUT` window expire with zero events seen
    /// (`turn_slot::spawn_turn_watchdog`).
    pub fn inc_stream_stalled(&self) {
        self.stream_stalled.fetch_add(1, Ordering::Relaxed);
    }

    /// Bumped when the chat turn watchdog observes the
    /// `MAX_IDLE_TIMEOUT` sliding window expire after at least one
    /// event was seen (`turn_slot::spawn_turn_watchdog`).
    pub fn inc_turn_timeout(&self) {
        self.turn_timeout.fetch_add(1, Ordering::Relaxed);
    }

    /// Bumped from the SSE stream's broadcast `Lagged` arm
    /// (`streaming::harness_broadcast_to_sse`) — Phase 1.2 made this
    /// arm non-terminal so the counter is the only signal that the
    /// consumer fell behind on a tool-heavy turn.
    pub fn inc_stream_lagged(&self) {
        self.stream_lagged.fetch_add(1, Ordering::Relaxed);
    }

    /// Bumped from `chat::busy::reject_if_partition_busy` (and the
    /// streaming partition route) when `acquire_turn_slot` returns
    /// `TurnSlotQueueFull`, i.e. a third concurrent send arrived for
    /// a partition that already has one active turn plus one queued.
    pub fn inc_agent_busy_queue_full(&self) {
        self.agent_busy_queue_full.fetch_add(1, Ordering::Relaxed);
    }

    /// Bumped by the persist task when the
    /// `assistant_message_end.usage.context_utilization` for an
    /// active chat session crosses `chat_auto_fork_threshold`, i.e.
    /// the moment the storage row is flagged `rolled_over` and the
    /// `rollover_summary` event is written.
    pub fn inc_auto_fork_triggered(&self) {
        self.auto_fork_triggered.fetch_add(1, Ordering::Relaxed);
    }

    /// Bumped by `persist::resolve_chat_session_with_pin` when the
    /// previously-flagged session is actually replaced with a fresh
    /// `SessionService::create_chat_followup_session` row on the
    /// next user send. The gap between `auto_fork_triggered` and
    /// `auto_fork_applied` is "users who hit the threshold but
    /// haven't sent again yet".
    pub fn inc_auto_fork_applied(&self) {
        self.auto_fork_applied.fetch_add(1, Ordering::Relaxed);
    }

    /// Bumped by `instance_route::send_event_stream` when the inbound
    /// POST carries an `X-Aura-Client-Retry: <n>` header — the Phase
    /// 2 client retry path. Header parse failures (non-numeric, not
    /// ASCII) are ignored and do NOT bump the counter.
    pub fn inc_client_auto_retry_streamdropped(&self) {
        self.client_auto_retry_streamdropped
            .fetch_add(1, Ordering::Relaxed);
    }

    /// Owned snapshot of the current counter values, joining the
    /// server-owned counters with the harness-owned static counters
    /// (`aura_os_harness::stability_metrics`). The `snapshot_at`
    /// timestamp is captured here so the JSON body is self-describing
    /// — the Debug UI uses it to compute "samples per second".
    #[must_use]
    pub fn snapshot(&self) -> StabilityMetricsSnapshot {
        StabilityMetricsSnapshot {
            chat_turns_started: self.chat_turns_started.load(Ordering::Relaxed),
            chat_turns_completed_ok: self.chat_turns_completed_ok.load(Ordering::Relaxed),
            stream_stalled: self.stream_stalled.load(Ordering::Relaxed),
            turn_timeout: self.turn_timeout.load(Ordering::Relaxed),
            stream_lagged: self.stream_lagged.load(Ordering::Relaxed),
            harness_ws_closed: aura_os_harness::stability_metrics::ws_closed(),
            harness_ws_read_error: aura_os_harness::stability_metrics::ws_read_error(),
            harness_protocol_mismatch: aura_os_harness::stability_metrics::protocol_mismatch(),
            harness_initial_connect_retries:
                aura_os_harness::stability_metrics::initial_connect_retries(),
            agent_busy_queue_full: self.agent_busy_queue_full.load(Ordering::Relaxed),
            auto_fork_triggered: self.auto_fork_triggered.load(Ordering::Relaxed),
            auto_fork_applied: self.auto_fork_applied.load(Ordering::Relaxed),
            client_auto_retry_streamdropped: self
                .client_auto_retry_streamdropped
                .load(Ordering::Relaxed),
            snapshot_at: chrono::Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every server-owned counter starts at zero — pinned because the
    /// `/api/admin/health` snapshot keys are stable parts of the
    /// operator-facing API. Harness-owned counters are static globals
    /// shared across the whole test binary, so we only assert the
    /// fields this struct actually owns.
    #[test]
    fn snapshot_reflects_zero_state_for_server_owned_counters() {
        let metrics = StabilityMetrics::new();
        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.chat_turns_started, 0);
        assert_eq!(snapshot.chat_turns_completed_ok, 0);
        assert_eq!(snapshot.stream_stalled, 0);
        assert_eq!(snapshot.turn_timeout, 0);
        assert_eq!(snapshot.stream_lagged, 0);
        assert_eq!(snapshot.agent_busy_queue_full, 0);
        assert_eq!(snapshot.auto_fork_triggered, 0);
        assert_eq!(snapshot.auto_fork_applied, 0);
        assert_eq!(snapshot.client_auto_retry_streamdropped, 0);
    }

    /// `inc_stream_lagged` is hit from
    /// `harness_broadcast_to_sse`'s new non-terminal `Lagged` arm
    /// (Phase 1.2). Drive 3 increments and confirm the snapshot
    /// reflects them — pins the counter against a future refactor
    /// that accidentally swaps the increment for a logger-only path.
    #[test]
    fn inc_stream_lagged_is_visible_in_snapshot() {
        let metrics = StabilityMetrics::new();
        metrics.inc_stream_lagged();
        metrics.inc_stream_lagged();
        metrics.inc_stream_lagged();
        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.stream_lagged, 3);
        assert_eq!(snapshot.stream_stalled, 0, "other counters unaffected");
    }

    /// `inc_stream_stalled` and `inc_turn_timeout` are owned by the
    /// sliding-idle watchdog (Phase 1). Drive each independently and
    /// confirm they advance only their own counter.
    #[test]
    fn watchdog_counters_advance_independently() {
        let metrics = StabilityMetrics::new();
        metrics.inc_stream_stalled();
        let stalled = metrics.snapshot();
        assert_eq!(stalled.stream_stalled, 1);
        assert_eq!(stalled.turn_timeout, 0);

        metrics.inc_turn_timeout();
        metrics.inc_turn_timeout();
        let both = metrics.snapshot();
        assert_eq!(both.stream_stalled, 1);
        assert_eq!(both.turn_timeout, 2);
    }

    /// Phase 3 auto-fork bookkeeping walks two counters: `triggered`
    /// fires when the persist task flags `rolled_over`, `applied`
    /// fires when the next user send actually mints the fresh
    /// session. Pin both so the JSON shape doesn't drift away from
    /// the Phase 3 commit semantics.
    #[test]
    fn auto_fork_counters_track_trigger_and_apply_separately() {
        let metrics = StabilityMetrics::new();
        metrics.inc_auto_fork_triggered();
        metrics.inc_auto_fork_triggered();
        metrics.inc_auto_fork_applied();
        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.auto_fork_triggered, 2);
        assert_eq!(snapshot.auto_fork_applied, 1);
    }

    /// `chat_turns_started` and `chat_turns_completed_ok` form a pair
    /// — the ratio between them is the operator-visible signal that
    /// the reliability work is actually keeping turns alive. Confirm
    /// they're independent counters so a partial-failure (started but
    /// errored) is still visible in the gap between them.
    #[test]
    fn chat_turn_lifecycle_counters_are_independent() {
        let metrics = StabilityMetrics::new();
        for _ in 0..5 {
            metrics.inc_chat_turns_started();
        }
        metrics.inc_chat_turns_completed_ok();
        metrics.inc_chat_turns_completed_ok();
        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.chat_turns_started, 5);
        assert_eq!(snapshot.chat_turns_completed_ok, 2);
    }

    /// Snapshot pulls the four harness-owned counters from the
    /// `aura-os-harness` static globals — wiring that the Debug UI
    /// relies on so a single `/api/admin/health` GET shows ws_bridge
    /// health alongside server-side counters. Read once before
    /// driving any harness increments to make the assertion robust
    /// to other tests that share the static globals.
    #[test]
    fn snapshot_reads_harness_owned_counters_through_accessors() {
        let metrics = StabilityMetrics::new();
        let before = metrics.snapshot();

        aura_os_harness::stability_metrics::inc_ws_closed();
        aura_os_harness::stability_metrics::inc_protocol_mismatch();
        aura_os_harness::stability_metrics::inc_protocol_mismatch();

        let after = metrics.snapshot();
        assert_eq!(after.harness_ws_closed, before.harness_ws_closed + 1);
        assert_eq!(
            after.harness_protocol_mismatch,
            before.harness_protocol_mismatch + 2
        );
        assert_eq!(
            after.harness_ws_read_error, before.harness_ws_read_error,
            "read_error untouched by other increments"
        );
    }

    /// `client_auto_retry_streamdropped` is owned by the server (it's
    /// bumped from `instance_route::send_event_stream` when the POST
    /// carries `X-Aura-Client-Retry`). Pin the counter so a future
    /// refactor of the request parser doesn't silently regress to
    /// "header read but counter never bumped".
    #[test]
    fn client_auto_retry_counter_advances_on_inc() {
        let metrics = StabilityMetrics::new();
        metrics.inc_client_auto_retry_streamdropped();
        metrics.inc_client_auto_retry_streamdropped();
        metrics.inc_client_auto_retry_streamdropped();
        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.client_auto_retry_streamdropped, 3);
    }
}
