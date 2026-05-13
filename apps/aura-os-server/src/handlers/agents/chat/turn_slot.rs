//! Per-partition turn slot: serializes user messages on a single
//! ChatSession partition so back-to-back sends queue instead of
//! racing the upstream harness turn-lock.
//!
//! Phase 3 of the robust-concurrent-agent-infra plan. The harness
//! enforces "one in-flight turn per agent_id". After Phase 1
//! `agent_id` is partitioned per AgentInstance, so cross-partition
//! traffic already runs in parallel; the remaining race is two
//! user messages arriving back-to-back on the SAME partition. The
//! WS writer accepts both into its mpsc, the harness rejects the
//! second with `code: turn_in_progress`, and Phase 2's SSE remap
//! cleans up the wording. This module prevents the race outright
//! by serializing the sends on the server side.
//!
//! Lifetime model: the HTTP handler returns immediately after
//! handing the SSE stream to axum, so a guard local to the handler
//! would unlock as soon as the first byte hit the wire. Instead we
//! hand the guard to a sentinel task that watches the harness
//! broadcast for the same terminal events the SSE forwarder treats
//! as `should_close` (`AssistantMessageEnd` / `Error`) and drops
//! the guard there, releasing the slot for the next queued turn.
//!
//! Queue depth is bounded at [`DEFAULT_MAX_PENDING_TURNS`] acquirers
//! (1 in-flight + 3 queued by default; tunable via
//! `AURA_PARTITION_TURN_QUEUE`, clamped to `[2, 1024]`). The N+1th
//! concurrent acquire returns `Err(TurnSlotQueueFull)` so the
//! orchestrator can surface `ApiError::agent_busy { reason: "queue
//! full" }` instead of letting the mutex pile up unbounded.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use aura_os_harness::{ErrorMsg, HarnessOutbound};
use tokio::sync::{broadcast, Mutex, OwnedMutexGuard};

use crate::stability_metrics::StabilityMetrics;

/// Default first-event timeout when `AURA_TURN_FIRST_EVENT_TIMEOUT_SECS`
/// is unset or invalid. Raised from the original 30s because Opus
/// router cold-start + first thinking delta is often >30s; a
/// premature `stream_stalled` synthesis killed turns that were
/// otherwise progressing normally upstream.
pub const DEFAULT_FIRST_EVENT_TIMEOUT_SECS: u64 = 120;

/// Default sliding-idle timeout when `AURA_TURN_MAX_TIMEOUT_SECS`
/// is unset or invalid. Interpreted as the maximum quiet window
/// between non-terminal events on the harness broadcast (NOT an
/// absolute wall-clock cap on the whole turn) — so a long Opus
/// turn that keeps emitting text-deltas or tool events for 20+
/// minutes will not synthesize `turn_timeout` mid-stream.
pub const DEFAULT_MAX_IDLE_TIMEOUT_SECS: u64 = 1800;

/// Default partition turn queue size when `AURA_PARTITION_TURN_QUEUE`
/// is unset or out of range. One actively holding the lock plus at
/// most three queued waiters; the fifth concurrent acquirer is
/// rejected up front. Raised from the original `2` (1 + 1) so two
/// users on the same agent partition (or a tab + a CEO `send_to_agent`
/// fan-out) no longer collide on the queue cap.
pub const DEFAULT_MAX_PENDING_TURNS: usize = 4;

/// Hard floor on the turn-queue cap. We refuse to drop below 2 because
/// that would forbid any queueing at all (every back-to-back send
/// would surface `agent_busy{queue_full}` even if the prior turn is
/// about to complete).
const MIN_MAX_PENDING_TURNS: usize = 2;

/// Hard ceiling on the turn-queue cap. Caps the worst-case lock-pile
/// per partition so a misconfigured env var can't blow process memory
/// with parked acquirers.
const MAX_MAX_PENDING_TURNS: usize = 1024;

fn read_max_pending_turns_from_env() -> usize {
    match std::env::var("AURA_PARTITION_TURN_QUEUE") {
        Ok(raw) => match raw.trim().parse::<usize>() {
            Ok(parsed) => parsed.clamp(MIN_MAX_PENDING_TURNS, MAX_MAX_PENDING_TURNS),
            Err(_) => DEFAULT_MAX_PENDING_TURNS,
        },
        Err(_) => DEFAULT_MAX_PENDING_TURNS,
    }
}

/// Process-wide cap on simultaneous "in-flight + queued" turns per
/// partition. Read once on first acquire from `AURA_PARTITION_TURN_QUEUE`
/// (default [`DEFAULT_MAX_PENDING_TURNS`]); subsequent calls hit the
/// `OnceLock` cache. Out-of-range or unparsable values fall back to
/// the default.
pub fn max_pending_turns() -> usize {
    static CACHED: OnceLock<usize> = OnceLock::new();
    *CACHED.get_or_init(read_max_pending_turns_from_env)
}

/// Returned by [`acquire_turn_slot`] when the partition already has
/// one turn in flight and one queued. The orchestrator translates
/// this into `ApiError::agent_busy` so callers see a structured
/// 409 instead of stacking unbounded behind the mutex.
#[derive(Debug)]
pub struct TurnSlotQueueFull;

/// Successful reservation of the per-partition turn slot.
pub struct TurnSlotAcquired {
    /// RAII guard that releases the slot on drop.
    pub guard: TurnSlotGuard,
    /// `true` when the caller had to wait for an in-flight turn to
    /// finish before the lock became available; the orchestrator
    /// uses this to prepend the synthetic `progress: queued` SSE
    /// event so the UI can render "Queued behind current turn".
    pub queued: bool,
}

/// Owns the partition mutex lock plus a strong reference to the
/// pending counter. Drop releases the mutex first so the next
/// waiter can proceed, then decrements the counter so a follow-on
/// `acquire_turn_slot` observes the correct queue depth.
pub struct TurnSlotGuard {
    inner: Option<OwnedMutexGuard<()>>,
    counter: Arc<AtomicUsize>,
}

impl Drop for TurnSlotGuard {
    fn drop(&mut self) {
        self.inner.take();
        self.counter.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Reserve the partition's turn slot.
///
/// 1. Increments `counter`. If the pre-increment value is already
///    `>= max_pending_turns()` (one running + N-1 queued), rolls back
///    and returns [`TurnSlotQueueFull`].
/// 2. Probes `try_lock_owned`. On success the slot was free, so
///    `queued = false` and the guard is held without ever yielding.
///    On failure another turn is in flight; we await `lock_owned`
///    and report `queued = true`.
pub async fn acquire_turn_slot(
    slot: Arc<Mutex<()>>,
    counter: Arc<AtomicUsize>,
) -> Result<TurnSlotAcquired, TurnSlotQueueFull> {
    acquire_turn_slot_with_cap(slot, counter, max_pending_turns()).await
}

/// Test-friendly variant of [`acquire_turn_slot`] that takes the cap
/// directly so unit tests can pin the queue depth without going
/// through the `AURA_PARTITION_TURN_QUEUE` env-var lifecycle. The
/// public entry point delegates here with the cached env-driven cap.
pub(crate) async fn acquire_turn_slot_with_cap(
    slot: Arc<Mutex<()>>,
    counter: Arc<AtomicUsize>,
    cap: usize,
) -> Result<TurnSlotAcquired, TurnSlotQueueFull> {
    let prev = counter.fetch_add(1, Ordering::AcqRel);
    if prev >= cap {
        counter.fetch_sub(1, Ordering::AcqRel);
        return Err(TurnSlotQueueFull);
    }
    let (inner, queued) = match Arc::clone(&slot).try_lock_owned() {
        Ok(g) => (g, false),
        Err(_) => (slot.lock_owned().await, true),
    };
    Ok(TurnSlotAcquired {
        guard: TurnSlotGuard {
            inner: Some(inner),
            counter,
        },
        queued,
    })
}

/// Spawn a sentinel that holds `guard` until the broadcast emits a
/// terminal event (AssistantMessageEnd / Error) or closes. Drops
/// the guard so the next queued turn can proceed.
///
/// `Lagged` is treated as a continue: the persist task already
/// drains through lag and the SSE forwarder surfaces the synthetic
/// "stream lagged" event. For the turn-slot we only care about the
/// terminal boundary, and the broadcast `Closed` arm handles the
/// catastrophic case where the harness dropped the channel before
/// emitting one.
pub(crate) fn spawn_turn_slot_release(
    guard: TurnSlotGuard,
    mut events_rx: broadcast::Receiver<HarnessOutbound>,
) {
    tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(HarnessOutbound::AssistantMessageEnd(_)) | Ok(HarnessOutbound::Error(_)) => {
                    break
                }
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
        drop(guard);
    });
}

/// Watchdog for a single chat turn.
///
/// `first_event_timeout` bounds the cold-start window: if the harness
/// emits no event at all within this duration, we synthesize a
/// `stream_stalled` error so the SSE client surfaces a real failure
/// rather than waiting on its idle timeout.
///
/// `max_turn_idle_timeout` is a **sliding** ceiling: it resets every
/// time a non-terminal event is observed on the broadcast. Only a
/// genuinely quiet window longer than this duration synthesizes a
/// `turn_timeout`. A long Opus turn that keeps streaming text-deltas
/// or tool events will never trip this, but a truly hung session will
/// after the configured idle window elapses with no traffic.
pub(crate) fn spawn_turn_watchdog(
    events_tx: broadcast::Sender<HarnessOutbound>,
    events_rx: broadcast::Receiver<HarnessOutbound>,
    first_event_timeout: Duration,
    max_turn_idle_timeout: Duration,
    metrics: Arc<StabilityMetrics>,
) {
    spawn_turn_watchdog_with_timeouts(
        events_tx,
        events_rx,
        first_event_timeout,
        max_turn_idle_timeout,
        Some(metrics),
    );
}

fn spawn_turn_watchdog_with_timeouts(
    events_tx: broadcast::Sender<HarnessOutbound>,
    mut events_rx: broadcast::Receiver<HarnessOutbound>,
    first_event_timeout: Duration,
    max_turn_idle_timeout: Duration,
    metrics: Option<Arc<StabilityMetrics>>,
) {
    tokio::spawn(async move {
        match tokio::time::timeout(first_event_timeout, events_rx.recv()).await {
            Ok(Ok(HarnessOutbound::AssistantMessageEnd(_)) | Ok(HarnessOutbound::Error(_))) => {
                return;
            }
            Ok(Ok(_)) | Ok(Err(broadcast::error::RecvError::Lagged(_))) => {}
            Ok(Err(broadcast::error::RecvError::Closed)) => return,
            Err(_) => {
                if let Some(m) = metrics.as_ref() {
                    m.inc_stream_stalled();
                }
                let _ = events_tx.send(timeout_error(
                    "stream_stalled",
                    format!(
                        "Remote agent did not emit any stream events within {}s.",
                        first_event_timeout.as_secs()
                    ),
                ));
                return;
            }
        }

        // Sliding ceiling: each non-terminal event resets the per-recv
        // timer. The previous hard `MAX_TURN_TIMEOUT` synthesized a
        // `turn_timeout` on long but actively-progressing turns; now
        // only a quiet window longer than `max_turn_idle_timeout`
        // trips. The Closed arm covers the case where the broadcast
        // is dropped before any terminal event arrives.
        loop {
            match tokio::time::timeout(max_turn_idle_timeout, events_rx.recv()).await {
                Ok(Ok(HarnessOutbound::AssistantMessageEnd(_)))
                | Ok(Ok(HarnessOutbound::Error(_)))
                | Ok(Err(broadcast::error::RecvError::Closed)) => return,
                Ok(Ok(_)) | Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Err(_) => {
                    if let Some(m) = metrics.as_ref() {
                        m.inc_turn_timeout();
                    }
                    let _ = events_tx.send(timeout_error(
                        "turn_timeout",
                        format!(
                            "Remote agent turn was idle for more than {}s with no progress event.",
                            max_turn_idle_timeout.as_secs()
                        ),
                    ));
                    return;
                }
            }
        }
    });
}

fn timeout_error(code: &str, message: String) -> HarnessOutbound {
    HarnessOutbound::Error(ErrorMsg {
        code: code.to_string(),
        message,
        recoverable: true,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use std::time::Duration;

    use aura_os_harness::{
        AssistantMessageEnd, ErrorMsg, FilesChanged, HarnessOutbound, SessionUsage,
    };
    use tokio::sync::{broadcast, Mutex};

    use super::{
        acquire_turn_slot, acquire_turn_slot_with_cap, max_pending_turns,
        spawn_turn_slot_release, spawn_turn_watchdog_with_timeouts, DEFAULT_MAX_PENDING_TURNS,
    };

    fn assistant_end() -> HarnessOutbound {
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        })
    }

    fn error_msg() -> HarnessOutbound {
        HarnessOutbound::Error(ErrorMsg {
            code: "boom".to_string(),
            message: "boom".to_string(),
            recoverable: false,
        })
    }

    #[tokio::test]
    async fn acquire_turn_slot_returns_not_queued_when_slot_is_free() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("free slot should acquire");
        assert!(
            !acquired.queued,
            "queued must be false on an uncontended acquire"
        );
        assert_eq!(counter.load(std::sync::atomic::Ordering::Acquire), 1);
        drop(acquired.guard);
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            0,
            "drop must decrement the pending counter"
        );
    }

    #[tokio::test]
    async fn acquire_turn_slot_returns_queued_when_slot_is_held() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("first acquire should succeed");
        assert!(!first.queued);

        let slot_clone = Arc::clone(&slot);
        let counter_clone = Arc::clone(&counter);
        let second_handle = tokio::spawn(async move {
            acquire_turn_slot(slot_clone, counter_clone)
                .await
                .expect("second acquire should eventually succeed")
        });

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !second_handle.is_finished(),
            "second acquire must block while the slot is held"
        );

        drop(first.guard);

        let second = tokio::time::timeout(Duration::from_millis(200), second_handle)
            .await
            .expect("second acquire timed out")
            .expect("second acquire join failed");
        assert!(
            second.queued,
            "queued must be true when the slot was already held at entry"
        );
    }

    #[tokio::test]
    async fn acquire_turn_slot_rejects_caller_past_default_cap() {
        // Phase 4 raised the partition cap from 2 to 4 (1 running + 3
        // queued by default). Saturate the slot at the new cap, then
        // confirm the (cap+1)th acquire is rejected as queue-full.
        //
        // Note: each queued acquirer holds the slot mutex inside its
        // returned `TurnSlotAcquired`; we drain them one-at-a-time and
        // drop each guard immediately so the next waiter can take the
        // lock. Without that drop the next `handle.await` would wedge
        // forever because the lock is still held.
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));

        let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("first acquire");

        let mut queued_handles = Vec::new();
        for _ in 1..DEFAULT_MAX_PENDING_TURNS {
            let slot_clone = Arc::clone(&slot);
            let counter_clone = Arc::clone(&counter);
            queued_handles.push(tokio::spawn(async move {
                acquire_turn_slot(slot_clone, counter_clone).await
            }));
        }

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            DEFAULT_MAX_PENDING_TURNS,
            "all acquirers must occupy the slot before the bound trips"
        );

        let overflow = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter)).await;
        assert!(
            overflow.is_err(),
            "concurrent acquire past the default cap must be rejected as queue-full"
        );
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            DEFAULT_MAX_PENDING_TURNS,
            "rejected acquire must roll back its counter increment"
        );

        drop(first.guard);
        for handle in queued_handles {
            let acquired = tokio::time::timeout(Duration::from_millis(500), handle)
                .await
                .expect("queued waiter timed out")
                .expect("queued join")
                .expect("queued acquire");
            // Drop NOW so the next waiter can take the lock; otherwise
            // the join above would hang behind the still-held guard.
            drop(acquired.guard);
        }
        assert_eq!(counter.load(std::sync::atomic::Ordering::Acquire), 0);
    }

    /// Phase 4 regression guard for the env-driven override path.
    /// `acquire_turn_slot_with_cap` lets tests pin the cap without
    /// having to leak `AURA_PARTITION_TURN_QUEUE` writes across the
    /// process; here we drive cap=3 directly, prove three acquirers
    /// fit and the fourth is rejected, then prove the public
    /// `max_pending_turns()` lookup still falls back to the
    /// `DEFAULT_MAX_PENDING_TURNS` baseline (since the env override is
    /// `OnceLock`-cached on first read and the test process never set
    /// it).
    #[tokio::test]
    async fn acquire_turn_slot_respects_env_override() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let cap = 3usize;

        let first = acquire_turn_slot_with_cap(Arc::clone(&slot), Arc::clone(&counter), cap)
            .await
            .expect("first acquire under override");

        let mut queued_handles = Vec::new();
        for _ in 1..cap {
            let slot_clone = Arc::clone(&slot);
            let counter_clone = Arc::clone(&counter);
            queued_handles.push(tokio::spawn(async move {
                acquire_turn_slot_with_cap(slot_clone, counter_clone, cap).await
            }));
        }

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            cap,
            "the override cap must bound the in-flight + queued count exactly"
        );

        let overflow =
            acquire_turn_slot_with_cap(Arc::clone(&slot), Arc::clone(&counter), cap).await;
        assert!(
            overflow.is_err(),
            "fourth acquire under cap=3 must be rejected as queue-full"
        );

        // The cached env-driven cap must remain at the documented
        // default since this test process never sets the env var.
        assert_eq!(
            max_pending_turns(),
            DEFAULT_MAX_PENDING_TURNS,
            "max_pending_turns() must default to DEFAULT_MAX_PENDING_TURNS without env override"
        );

        drop(first.guard);
        for handle in queued_handles {
            let acquired = tokio::time::timeout(Duration::from_millis(500), handle)
                .await
                .expect("override queued waiter timed out")
                .expect("override queued join")
                .expect("override queued acquire");
            drop(acquired.guard);
        }
        assert_eq!(counter.load(std::sync::atomic::Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn spawn_turn_slot_release_releases_on_assistant_message_end() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel(8);

        spawn_turn_slot_release(acquired.guard, events_rx);

        events_tx
            .send(assistant_end())
            .expect("send terminal event");

        let next = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                if let Ok(acquired) = Arc::clone(&slot).try_lock_owned() {
                    return acquired;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("slot should be released after assistant_message_end");
        drop(next);
    }

    #[tokio::test]
    async fn spawn_turn_slot_release_releases_on_error() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel(8);

        spawn_turn_slot_release(acquired.guard, events_rx);

        events_tx.send(error_msg()).expect("send error event");

        let next = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                if let Ok(acquired) = Arc::clone(&slot).try_lock_owned() {
                    return acquired;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("slot should be released after error event");
        drop(next);
    }

    #[tokio::test]
    async fn spawn_turn_slot_release_releases_on_broadcast_close() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel::<HarnessOutbound>(8);

        spawn_turn_slot_release(acquired.guard, events_rx);

        drop(events_tx);

        let next = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                if let Ok(acquired) = Arc::clone(&slot).try_lock_owned() {
                    return acquired;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("slot should be released after broadcast close");
        drop(next);
    }

    #[tokio::test]
    async fn turn_watchdog_emits_stream_stalled_when_no_first_event_arrives() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx,
            rx,
            Duration::from_millis(10),
            Duration::from_secs(1),
            None,
        );

        let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
            .await
            .expect("watchdog event timed out")
            .expect("watchdog broadcast");
        assert!(matches!(
            event,
            HarnessOutbound::Error(ErrorMsg { ref code, .. }) if code == "stream_stalled"
        ));
    }

    /// Phase 5 wiring: when a `stream_stalled` synthesis fires, the
    /// watchdog must also bump the
    /// [`crate::stability_metrics::StabilityMetrics::inc_stream_stalled`]
    /// counter. Drives the same first-event timeout as the prior
    /// test, then asserts the snapshot moved by exactly +1 (and that
    /// the unrelated `turn_timeout` counter stayed put).
    #[tokio::test]
    async fn turn_watchdog_increments_stream_stalled_metric_on_first_event_timeout() {
        use crate::stability_metrics::StabilityMetrics;
        use std::sync::Arc as StdArc;

        let metrics = StdArc::new(StabilityMetrics::new());
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx,
            rx,
            Duration::from_millis(10),
            Duration::from_secs(1),
            Some(StdArc::clone(&metrics)),
        );

        let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
            .await
            .expect("watchdog event timed out")
            .expect("watchdog broadcast");
        assert!(matches!(
            event,
            HarnessOutbound::Error(ErrorMsg { ref code, .. }) if code == "stream_stalled"
        ));

        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.stream_stalled, 1, "stalled counter must advance");
        assert_eq!(
            snapshot.turn_timeout, 0,
            "turn_timeout must not advance on first-event stall"
        );
    }

    /// Phase 5 wiring: when the sliding-idle watchdog synthesizes a
    /// `turn_timeout`, it must bump the
    /// [`crate::stability_metrics::StabilityMetrics::inc_turn_timeout`]
    /// counter. Drives the same idle-exceeded scenario as the prior
    /// test, then asserts the snapshot reflects exactly +1 on the
    /// `turn_timeout` counter (and `stream_stalled` is unaffected).
    #[tokio::test]
    async fn turn_watchdog_increments_turn_timeout_metric_on_idle_exceeded() {
        use crate::stability_metrics::StabilityMetrics;
        use std::sync::Arc as StdArc;

        let metrics = StdArc::new(StabilityMetrics::new());
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx.clone(),
            rx,
            Duration::from_secs(1),
            Duration::from_millis(10),
            Some(StdArc::clone(&metrics)),
        );
        tx.send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
            text: "working".to_string(),
        }))
        .expect("seed nonterminal event");

        let mut saw_timeout = false;
        for _ in 0..2 {
            let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
                .await
                .expect("watchdog event timed out")
                .expect("watchdog broadcast");
            if matches!(
                event,
                HarnessOutbound::Error(ErrorMsg { ref code, .. }) if code == "turn_timeout"
            ) {
                saw_timeout = true;
                break;
            }
        }
        assert!(saw_timeout, "watchdog must emit turn_timeout");

        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.turn_timeout, 1, "turn_timeout counter must advance");
        assert_eq!(
            snapshot.stream_stalled, 0,
            "stream_stalled must not advance on sliding-idle timeout"
        );
    }

    /// Sliding-idle watchdog: a single non-terminal event lifts the
    /// watchdog out of `first_event_timeout` into the per-recv idle
    /// loop. With no further traffic, the idle window must trip the
    /// `turn_timeout` synth — pinning the behaviour for the
    /// genuinely-hung case after the Phase-1 sliding rewrite.
    #[tokio::test]
    async fn turn_watchdog_emits_turn_timeout_when_idle_exceeded() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx.clone(),
            rx,
            Duration::from_secs(1),
            Duration::from_millis(10),
            None,
        );
        tx.send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
            text: "working".to_string(),
        }))
        .expect("seed nonterminal event");

        let mut saw_timeout = false;
        for _ in 0..2 {
            let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
                .await
                .expect("watchdog event timed out")
                .expect("watchdog broadcast");
            if matches!(
                event,
                HarnessOutbound::Error(ErrorMsg { ref code, .. }) if code == "turn_timeout"
            ) {
                saw_timeout = true;
                break;
            }
        }
        assert!(saw_timeout, "watchdog must emit turn_timeout");
    }

    /// Sliding-idle regression guard for Phase 1.1: the watchdog must
    /// keep the per-recv idle timer ticking against the most recent
    /// event, not against the wall-clock start of the turn. Periodic
    /// non-terminal events arriving at `idle / 2` cadence for `idle *
    /// 3` of wall-clock time must NOT synthesize a `turn_timeout`.
    #[tokio::test]
    async fn turn_watchdog_sliding_idle_resets_on_periodic_events() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(64);
        let mut observed = tx.subscribe();

        let idle = Duration::from_millis(200);
        let interval = idle / 2;
        let total = idle * 3;

        spawn_turn_watchdog_with_timeouts(tx.clone(), rx, Duration::from_secs(5), idle, None);

        // Seed traffic at idle/2 cadence for idle*3 wall-clock seconds.
        // Each send must arrive on the broadcast inside the watchdog's
        // current idle window, resetting its timer.
        let started = std::time::Instant::now();
        let mut tick = 0usize;
        while started.elapsed() < total {
            tx.send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
                text: format!("tick-{tick}"),
            }))
            .expect("seed sliding delta");
            tick += 1;
            tokio::time::sleep(interval).await;
        }
        assert!(
            tick >= 4,
            "test must emit enough deltas to outlast a non-sliding window (sent {tick})"
        );

        // Drain whatever observed picked up. We DO NOT close the
        // watchdog yet — if the sliding clock was broken, a
        // `turn_timeout` Error would already be sitting in the
        // broadcast.
        loop {
            match tokio::time::timeout(Duration::from_millis(10), observed.recv()).await {
                Ok(Ok(event)) => {
                    assert!(
                        !matches!(
                            event,
                            HarnessOutbound::Error(ErrorMsg { ref code, .. })
                                if code == "turn_timeout"
                        ),
                        "sliding watchdog must not emit turn_timeout while periodic events arrive"
                    );
                }
                Ok(Err(_)) | Err(_) => break,
            }
        }
    }
}
