//! Release sentinel for the turn slot: spawns a tokio task that holds
//! the `TurnSlotGuard` until the harness emits a terminal event for the
//! turn (or the broadcast closes).

use aura_os_harness::HarnessOutbound;
use tokio::sync::broadcast;

use super::acquire::TurnSlotGuard;

/// Spawn a sentinel that holds `guard` until the broadcast emits a
/// terminal event (`AssistantMessageEnd` / `Error`) or closes.
///
/// Intelligent-reconnect behaviour change: a PASSIVE SSE disconnect
/// (the UI closed the response body on Stop's `AbortController.abort()`
/// or a browser refresh) no longer early-releases the slot, because the
/// reused harness turn keeps running so a reconnecting UI can reattach
/// to its registered live stream. The slot is therefore tied strictly
/// to the turn's lifetime on the harness:
///
/// - Normal completion releases here on the harness terminal event.
/// - A genuinely stalled turn is bounded by `spawn_turn_watchdog`, which
///   emits a synthetic terminal event on idle/first-event timeout that
///   this sentinel observes — so the slot can never leak indefinitely.
/// - Explicit Stop (`POST .../cancel-turn`) forwards
///   `HarnessInbound::Cancel` and evicts the warm session via
///   `setup/cancel.rs`; the harness then emits its own terminal event
///   which this sentinel observes. That path is independent of the SSE
///   body, so Stop still releases the slot promptly.
///
/// `Lagged` is treated as a continue: the persist task already drains
/// through lag and the SSE forwarder surfaces the synthetic "stream
/// lagged" event. For the turn-slot we only care about the terminal
/// boundary, and the broadcast `Closed` arm handles the catastrophic
/// case where the harness dropped the channel before emitting one.
pub(crate) fn spawn_turn_slot_release(
    guard: TurnSlotGuard,
    mut events_rx: broadcast::Receiver<HarnessOutbound>,
) {
    tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(HarnessOutbound::AssistantMessageEnd(_)) | Ok(HarnessOutbound::Error(_)) => {
                    break;
                }
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
        drop(guard);
    });
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

    use super::super::acquire::acquire_turn_slot;
    use super::spawn_turn_slot_release;

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
            support_id: None,
        })
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

    /// Intelligent-reconnect regression guard: a passive SSE disconnect
    /// no longer early-releases the slot. With only non-terminal frames
    /// observed (and no terminal event yet), the sentinel must keep the
    /// guard held so the reused harness turn keeps running for reattach
    /// and a back-to-back send still serializes behind it. The slot is
    /// released only once a terminal event arrives (here, after we let
    /// the turn "complete").
    #[tokio::test]
    async fn spawn_turn_slot_release_holds_slot_until_terminal_event() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel::<HarnessOutbound>(8);

        spawn_turn_slot_release(acquired.guard, events_rx);

        // Only a non-terminal frame so far: the slot must stay held even
        // though a passive SSE disconnect would have happened by now.
        events_tx
            .send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
                text: "still working".to_string(),
            }))
            .expect("send non-terminal event");

        let held = tokio::time::timeout(Duration::from_millis(100), async {
            loop {
                if Arc::clone(&slot).try_lock_owned().is_ok() {
                    return true; // unexpectedly released
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await;
        assert!(
            held.is_err(),
            "slot must stay held while the turn is still in flight (no terminal event yet)",
        );

        // Now the turn completes: the slot must release.
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
        .expect("slot should be released after the terminal event");
        drop(next);
    }
}
