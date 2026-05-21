//! Regression tests for the LoopActivity-side task-pointer update.
//!
//! `LoopHandle` is the single authoritative source of truth for the
//! current task pointer: `task_started` pushes the typed `TaskId`
//! onto `LoopActivity.current_task_id`, and the `/api/loops/status`
//! poll endpoint reads it back from the same place via
//! `LoopRegistry::snapshot_where`. The frontend's per-task spinner
//! in `TaskList` binds to the activity payload via
//! `selectTaskActivity(state, taskId)` — which filters
//! `row.activity.current_task_id === taskId` — so without this
//! update the spinner cannot bind and the UI looks idle even while
//! the harness is actively working.
//!
//! These tests pin the LoopHandle-side contract through the live
//! `LoopRegistry` so the regression cannot return.

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, TaskId, UserId};
use aura_os_events::{EventHub, LoopId, LoopKind};
use aura_os_loops::{LoopHandle, LoopRegistry};

use super::push_loop_activity_task;

fn make_handle() -> (LoopRegistry, LoopHandle) {
    let registry = LoopRegistry::new(EventHub::new());
    let loop_id = LoopId::new(
        UserId::new(),
        Some(ProjectId::new()),
        Some(AgentInstanceId::new()),
        AgentId::new(),
        LoopKind::Automation,
    );
    let handle = registry.open(loop_id);
    (registry, handle)
}

#[tokio::test]
async fn push_loop_activity_task_publishes_uuid_to_loop_activity() {
    let (registry, handle) = make_handle();
    let task_id = TaskId::new();
    let task_id_str = task_id.to_string();

    push_loop_activity_task(&handle, Some(&task_id_str)).await;

    let snap = registry.snapshot_one(handle.loop_id()).expect("registered");
    assert_eq!(
        snap.activity.current_task_id,
        Some(task_id),
        "task_started must publish the task id onto LoopActivity so the per-task UI spinner can bind",
    );
    handle.mark_completed().await;
}

#[tokio::test]
async fn push_loop_activity_task_clears_on_terminal() {
    let (registry, handle) = make_handle();
    let task_id = TaskId::new();
    let task_id_str = task_id.to_string();

    push_loop_activity_task(&handle, Some(&task_id_str)).await;
    push_loop_activity_task(&handle, None).await;

    let snap = registry.snapshot_one(handle.loop_id()).expect("registered");
    assert!(
        snap.activity.current_task_id.is_none(),
        "task_completed / task_failed must clear LoopActivity.current_task_id so the next task's spinner doesn't inherit a stale binding",
    );
    handle.mark_completed().await;
}

#[tokio::test]
async fn push_loop_activity_task_drops_synthetic_ids() {
    let (registry, handle) = make_handle();

    // Some harness code paths still emit synthetic `"runner-<n>"`
    // ids that never match a real DB row. We deliberately clear the
    // pointer instead of binding to a non-existent task: a stale
    // wrong pointer would be worse than an unset one for the
    // `selectTaskActivity` filter.
    push_loop_activity_task(&handle, Some("runner-0")).await;

    let snap = registry.snapshot_one(handle.loop_id()).expect("registered");
    assert!(
        snap.activity.current_task_id.is_none(),
        "non-UUID task ids must not pollute LoopActivity.current_task_id",
    );
    handle.mark_completed().await;
}
