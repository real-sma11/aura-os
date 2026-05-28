use super::*;
use aura_os_core::{AgentId, AgentInstanceId, ProjectId, TaskId, UserId};
use aura_os_events::{LoopKind, SubscriptionFilter, Topic};

fn fresh_loop_id(project: ProjectId, instance: AgentInstanceId, kind: LoopKind) -> LoopId {
    LoopId::new(
        UserId::new(),
        Some(project),
        Some(instance),
        AgentId::new(),
        kind,
    )
}

#[tokio::test]
async fn opening_a_loop_emits_loop_opened() {
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let loop_id = fresh_loop_id(project, AgentInstanceId::new(), LoopKind::Chat);
    let _handle = registry.open(loop_id.clone());

    let evt = rx.recv().await.expect("opened");
    assert!(matches!(evt.as_ref(), DomainEvent::LoopOpened(p) if p.loop_id == loop_id));
    assert_eq!(registry.len(), 1);
}

#[tokio::test]
async fn dropping_handle_without_terminal_publishes_cancelled() {
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    {
        let loop_id = fresh_loop_id(project, AgentInstanceId::new(), LoopKind::Automation);
        let _h = registry.open(loop_id);
    }
    let opened = rx.recv().await.unwrap();
    assert!(matches!(opened.as_ref(), DomainEvent::LoopOpened(_)));
    let ended = rx.recv().await.unwrap();
    match ended.as_ref() {
        DomainEvent::LoopEnded(p) => assert_eq!(p.activity.status, LoopStatus::Cancelled),
        other => panic!("expected LoopEnded, got {other:?}"),
    }
    assert_eq!(registry.len(), 0);
}

#[tokio::test]
async fn transitions_publish_activity_changed() {
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let handle = registry.open(fresh_loop_id(
        project,
        AgentInstanceId::new(),
        LoopKind::TaskRun,
    ));

    // Drain the LoopOpened.
    let _ = rx.recv().await;

    handle
        .mark_running(Some(0.25), Some("thinking".into()))
        .await;

    let evt = rx.recv().await.unwrap();
    match evt.as_ref() {
        DomainEvent::LoopActivityChanged(p) => {
            assert_eq!(p.activity.status, LoopStatus::Running);
            assert_eq!(p.activity.percent, Some(0.25));
            assert_eq!(p.activity.current_step.as_deref(), Some("thinking"));
        }
        other => panic!("expected LoopActivityChanged, got {other:?}"),
    }
    handle.mark_completed().await;
    let evt = rx.recv().await.unwrap();
    assert!(matches!(
        evt.as_ref(),
        DomainEvent::LoopEnded(p) if p.activity.status == LoopStatus::Completed
    ));
    assert_eq!(registry.len(), 0);
}

#[tokio::test]
async fn transition_throttles_same_status_updates() {
    use std::time::Duration as StdDuration;

    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let handle = registry.open(fresh_loop_id(
        project,
        AgentInstanceId::new(),
        LoopKind::Chat,
    ));

    // Drain the LoopOpened.
    let _ = rx.recv().await;

    // First transition into Running: status changes, so it bypasses
    // the throttle and publishes immediately.
    handle
        .mark_running(Some(0.1), Some("thinking".into()))
        .await;
    let first = rx.recv().await.unwrap();
    assert!(matches!(
        first.as_ref(),
        DomainEvent::LoopActivityChanged(_)
    ));

    // A burst of same-status transitions within the throttle window
    // should NOT publish more events.
    for i in 0..20 {
        handle
            .transition(|activity| {
                activity.percent = Some(0.1 + (i as f32) * 0.01);
            })
            .await;
    }
    let drained = tokio::time::timeout(StdDuration::from_millis(50), rx.recv()).await;
    assert!(
        drained.is_err(),
        "throttle must suppress same-status updates within the 250ms window"
    );

    // A real status change (Running -> WaitingTool) must bypass the
    // throttle and publish immediately, even while we're still
    // inside the 250ms window.
    handle.mark_waiting_tool("read_file").await;
    let after_status_change = tokio::time::timeout(StdDuration::from_millis(50), rx.recv())
        .await
        .expect("status change must bypass throttle")
        .expect("event");
    match after_status_change.as_ref() {
        DomainEvent::LoopActivityChanged(p) => {
            assert_eq!(p.activity.status, LoopStatus::WaitingTool);
        }
        other => panic!("expected LoopActivityChanged, got {other:?}"),
    }

    // After the throttle window elapses, a same-status transition
    // publishes again.
    tokio::time::sleep(ACTIVITY_PUBLISH_INTERVAL + StdDuration::from_millis(50)).await;
    handle
        .transition(|activity| {
            activity.current_step = Some("tool: read_file (still)".into());
        })
        .await;
    let after_window = tokio::time::timeout(StdDuration::from_millis(100), rx.recv())
        .await
        .expect("throttle must release after window")
        .expect("event");
    assert!(matches!(
        after_window.as_ref(),
        DomainEvent::LoopActivityChanged(_)
    ));

    handle.mark_completed().await;
    let end = rx.recv().await.unwrap();
    assert!(matches!(end.as_ref(), DomainEvent::LoopEnded(_)));
}

#[tokio::test]
async fn set_current_task_bypasses_throttle_even_without_status_change() {
    use std::time::Duration as StdDuration;

    // Regression: the very first `set_current_task` after `open()` is
    // typically driven by the harness's `task_started` event. It only
    // mutates `current_task_id` and leaves `status = Starting`, so
    // before the bypass the 4 Hz throttle could swallow the publish
    // (the `last_published_ms` baseline is seeded with the open
    // timestamp, so `elapsed_ms` is well under 250ms). Without the
    // publish, the frontend's `loop-activity-store` keeps the seed
    // payload (`current_task_id: None`) and `selectTaskActivity`
    // returns null, so the per-task UI spinner cannot bind and the
    // active task renders as a hollow circle.
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let handle = registry.open(fresh_loop_id(
        project,
        AgentInstanceId::new(),
        LoopKind::Automation,
    ));

    // Drain the LoopOpened.
    let _ = rx.recv().await;

    let task_id = TaskId::new();
    handle.set_current_task(Some(task_id)).await;

    let evt = tokio::time::timeout(StdDuration::from_millis(50), rx.recv())
        .await
        .expect("set_current_task must bypass the throttle when current_task_id changes")
        .expect("event");
    match evt.as_ref() {
        DomainEvent::LoopActivityChanged(p) => {
            assert_eq!(p.activity.current_task_id, Some(task_id));
            assert_eq!(p.activity.status, LoopStatus::Starting);
        }
        other => panic!("expected LoopActivityChanged, got {other:?}"),
    }

    // Clearing the binding (`task_completed` / `task_failed` calls
    // `set_current_task(None)`) is also a task-pointer change and
    // must publish, even back-to-back within the throttle window.
    handle.set_current_task(None).await;
    let evt = tokio::time::timeout(StdDuration::from_millis(50), rx.recv())
        .await
        .expect("clearing current_task_id must bypass the throttle too")
        .expect("event");
    match evt.as_ref() {
        DomainEvent::LoopActivityChanged(p) => {
            assert_eq!(p.activity.current_task_id, None);
        }
        other => panic!("expected LoopActivityChanged, got {other:?}"),
    }

    handle.mark_completed().await;
    let _ = rx.recv().await;
}

#[tokio::test]
async fn re_emit_loop_opened_publishes_for_known_loop() {
    // Regression: the dev-loop adopt-shortcut path skips
    // `register_active_automaton` (and therefore `LoopRegistry::open`)
    // when it reuses an existing forwarder, but the FE's
    // `useLoopActivityStore` is only seeded by the `LoopOpened` event
    // the bridge mirrors. `re_emit_loop_opened` is the seam that lets
    // the adopt path republish that frame against the live activity
    // snapshot without minting a fresh handle.
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let loop_id = fresh_loop_id(project, AgentInstanceId::new(), LoopKind::Automation);
    let handle = registry.open(loop_id.clone());

    // Drain the initial LoopOpened from `open()`.
    let _ = rx.recv().await;

    // Advance the live activity so we can assert the re-emit carries
    // the *current* snapshot rather than the original `Starting` seed.
    handle
        .mark_running(Some(0.5), Some("re-emit test".into()))
        .await;
    let _ = rx.recv().await;

    assert!(registry.re_emit_loop_opened(&loop_id));
    let evt = rx.recv().await.expect("re_emit publishes a LoopOpened");
    match evt.as_ref() {
        DomainEvent::LoopOpened(payload) => {
            assert_eq!(payload.loop_id, loop_id);
            assert_eq!(payload.activity.status, LoopStatus::Running);
            assert_eq!(payload.activity.percent, Some(0.5));
            assert_eq!(
                payload.activity.current_step.as_deref(),
                Some("re-emit test")
            );
        }
        other => panic!("expected LoopOpened, got {other:?}"),
    }

    handle.mark_completed().await;
    let _ = rx.recv().await;
}

#[tokio::test]
async fn re_emit_loop_opened_is_noop_for_unknown_loop() {
    use std::time::Duration as StdDuration;

    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let unknown = fresh_loop_id(project, AgentInstanceId::new(), LoopKind::Automation);

    assert!(!registry.re_emit_loop_opened(&unknown));
    // Nothing should hit the bus — wait briefly to catch a stray publish.
    let nothing = tokio::time::timeout(StdDuration::from_millis(50), rx.recv()).await;
    assert!(
        nothing.is_err(),
        "re_emit on an unknown loop must not publish any event"
    );
}

#[tokio::test]
async fn snapshot_filters_by_project() {
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub);
    let p1 = ProjectId::new();
    let p2 = ProjectId::new();
    let l1 = registry.open(fresh_loop_id(p1, AgentInstanceId::new(), LoopKind::Chat));
    let _l2 = registry.open(fresh_loop_id(p2, AgentInstanceId::new(), LoopKind::Chat));

    let snap = registry.snapshot_where(loops_in_project(p1));
    assert_eq!(snap.len(), 1);
    assert_eq!(snap[0].loop_id, *l1.loop_id());
}
