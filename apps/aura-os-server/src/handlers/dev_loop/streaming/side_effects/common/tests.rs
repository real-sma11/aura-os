//! Regression tests for the LoopActivity-side task-pointer update.
//!
//! Bug background: the dev-loop forwarder's `task_started` handler
//! used to only write `automaton_registry.current_task_id` (which
//! powers the legacy `/api/loops/status` poll endpoint) and never
//! pushed the task id onto `LoopActivity.current_task_id`. The
//! frontend's per-task spinner in `TaskList` binds to the activity
//! payload via `selectTaskActivity(state, taskId)` — which filters
//! `row.activity.current_task_id === taskId` — so the spinner stayed
//! dark for the entire dev-loop run and the UI looked idle even
//! while the harness was actively working. The user reported "the
//! spinner is broken if run is still going (i thought it was turned
//! off when it wasn't)" — that's this bug.
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
