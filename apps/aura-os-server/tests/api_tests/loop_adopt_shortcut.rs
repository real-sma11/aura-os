//! Regression coverage for the FE-bridge wire-shape contract of the
//! dev-loop adopt-shortcut path.
//!
//! When `run/mod.rs::adopt_shortcut_outcome` returns the
//! `AdoptShortcutReused` outcome, it must call
//! `LoopRegistry::re_emit_loop_opened(&loop_id)` so the bridge
//! mirrors a fresh `{"type":"loop_opened",...}` JSON frame onto
//! `event_broadcast`. Without that re-emit, `useLoopActivityStore` on
//! the FE stays empty for the entire lifetime of a reused loop and
//! the three live surfaces that depend on it (nav-bar loop ring,
//! per-task row spinners, Run pane) sit idle even while the harness
//! is actively working — even though the legacy `loop_started` event
//! keeps `AutomationBar` happy via its parallel `/loop/status` HTTP
//! path.
//!
//! This test pins the end-to-end contract from the registry helper
//! all the way through `aura_os_server::loop_events_bridge` to the
//! `event_broadcast` JSON frame the FE actually consumes off
//! `/ws/events`.
use std::time::Duration;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, UserId};
use aura_os_events::{LoopId, LoopKind};

use crate::common::*;

#[tokio::test]
async fn adopt_shortcut_re_emit_lands_loop_opened_on_event_broadcast() {
    let (_app, state, _db) = build_test_app();

    // The bare `build_test_app` harness deliberately omits the
    // production `spawn_loop_events_bridge` call (that lives in
    // `app_builder::build_app_state`, which the test harness doesn't
    // reach). Stand the bridge up by hand so the test exercises the
    // real `render_event` JSON code path rather than asserting against
    // typed `DomainEvent` enums only.
    aura_os_server::loop_events_bridge::spawn_loop_events_bridge(
        state.event_hub.clone(),
        state.event_broadcast.clone(),
    );

    let mut event_rx = state.event_broadcast.subscribe();

    let loop_id = LoopId::new(
        UserId::new(),
        Some(ProjectId::new()),
        Some(AgentInstanceId::new()),
        AgentId::new(),
        LoopKind::Automation,
    );

    // First `open` mints the slot and publishes the inaugural
    // `LoopOpened`. Drain it so the next frame we observe is
    // unambiguously the adopt-shortcut re-emit.
    let _handle = state.loop_registry.open(loop_id.clone());
    let opened = tokio::time::timeout(Duration::from_millis(500), event_rx.recv())
        .await
        .expect("initial loop_opened JSON frame should land within 500ms")
        .expect("event_broadcast channel should yield a frame");
    assert_eq!(opened["type"], "loop_opened");
    assert_eq!(
        opened["project_id"],
        loop_id.project_id.unwrap().to_string()
    );
    assert_eq!(
        opened["agent_instance_id"],
        loop_id.agent_instance_id.unwrap().to_string()
    );

    // Now exercise the adopt-shortcut path's contract: a second
    // `loop_opened` JSON frame must land each time
    // `re_emit_loop_opened` fires for a live slot, carrying the same
    // loop identity and the current activity snapshot. This is what
    // `adopt_shortcut_outcome` does after the legacy
    // `emit_domain_event("loop_started", ...)` call to wake up the
    // FE's typed-event consumers.
    assert!(
        state.loop_registry.re_emit_loop_opened(&loop_id),
        "re_emit_loop_opened should report `true` for a live slot",
    );

    let re_emitted = tokio::time::timeout(Duration::from_millis(500), event_rx.recv())
        .await
        .expect("re-emit loop_opened JSON frame should land within 500ms")
        .expect("event_broadcast channel should yield a frame");
    assert_eq!(re_emitted["type"], "loop_opened");
    assert_eq!(
        re_emitted["project_id"],
        loop_id.project_id.unwrap().to_string()
    );
    assert_eq!(
        re_emitted["agent_instance_id"],
        loop_id.agent_instance_id.unwrap().to_string()
    );
    // The activity snapshot must be embedded so the FE seeds
    // `useLoopActivityStore` with the live state, not a sentinel.
    assert!(
        re_emitted["activity"].is_object(),
        "re-emitted loop_opened must carry the current activity snapshot, got: {re_emitted}",
    );
    // `status` is the field `useLoopActivityStore` selectors key off
    // for spinners; pin it explicitly so a schema rename can't
    // silently break the FE.
    assert!(
        re_emitted["activity"]["status"].is_string(),
        "activity.status must be a string on the re-emitted frame, got: {re_emitted}",
    );
}

#[tokio::test]
async fn adopt_shortcut_re_emit_no_op_for_unknown_loop() {
    // The complementary contract: when the registry has no live slot
    // for the loop id (e.g. a server restart left the forwarder slot
    // wired up without a matching registry entry), `re_emit_loop_opened`
    // must report `false` and emit nothing on `event_broadcast`. The
    // adopt-shortcut handler logs at `debug!` in that case and lets
    // the FE stay empty — better than publishing a stale snapshot.
    let (_app, state, _db) = build_test_app();
    aura_os_server::loop_events_bridge::spawn_loop_events_bridge(
        state.event_hub.clone(),
        state.event_broadcast.clone(),
    );

    let mut event_rx = state.event_broadcast.subscribe();

    let loop_id = LoopId::new(
        UserId::new(),
        Some(ProjectId::new()),
        Some(AgentInstanceId::new()),
        AgentId::new(),
        LoopKind::Automation,
    );

    assert!(
        !state.loop_registry.re_emit_loop_opened(&loop_id),
        "re_emit_loop_opened must report `false` when the slot is absent",
    );

    // Nothing should land on the broadcast channel — give the runtime
    // a generous window to surface any stray emission.
    let stray = tokio::time::timeout(Duration::from_millis(100), event_rx.recv()).await;
    assert!(
        stray.is_err(),
        "no event should be emitted for a missing-slot re-emit, got: {stray:?}",
    );
}
