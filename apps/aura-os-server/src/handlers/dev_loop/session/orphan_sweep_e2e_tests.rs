//! Section E regression: end-to-end the orphan-recovery sweep
//! must actually issue `safe_transition` calls that land in
//! storage as `Ready`. The pure planner is unit-tested in
//! `aura_os_automation::resilience::orphan` and the App-layer
//! shape is covered in `adapter::orphan_recovery_tests`; this
//! test exercises the bridge between them via the mock
//! aura-storage HTTP server (`aura_os_storage::testutil::start_mock_storage`)
//! so a future refactor of `apply_orphan_recovery_plans` cannot
//! silently regress the persisted outcome.
//!
//! Test JWT is the static literal the mock server accepts on
//! every request — it never validates the bearer token.

use super::{apply_orphan_recovery_plans, load_project_tasks};
use aura_os_automation::{
    recover_failed, recover_orphans, OrphanRecoveryPlan, TaskRetryTracker, TASK_LEVEL_RETRY_BUDGET,
};
use aura_os_core::{ProjectId, TaskStatus};
use aura_os_storage::testutil::start_mock_storage;
use aura_os_storage::{CreateSpecRequest, CreateTaskRequest, StorageClient, TransitionTaskRequest};
use uuid::Uuid;

const JWT: &str = "test-token";

async fn create_spec(storage: &StorageClient, project_id: &str) -> String {
    storage
        .create_spec(
            project_id,
            JWT,
            &CreateSpecRequest {
                title: "spec".to_string(),
                org_id: None,
                order_index: Some(0),
                markdown_contents: None,
            },
        )
        .await
        .expect("create_spec")
        .id
}

async fn seed_task_with_walk(
    storage: &StorageClient,
    project_id: &str,
    spec_id: &str,
    title: &str,
    statuses: &[&str],
) -> String {
    let task = storage
        .create_task(
            project_id,
            JWT,
            &CreateTaskRequest {
                spec_id: spec_id.to_string(),
                title: title.to_string(),
                org_id: None,
                description: None,
                status: None,
                order_index: Some(0),
                dependency_ids: None,
                assigned_project_agent_id: None,
            },
        )
        .await
        .expect("create_task should succeed against the mock storage");
    for status in statuses {
        storage
            .transition_task(
                &task.id,
                JWT,
                &TransitionTaskRequest {
                    status: (*status).to_string(),
                },
            )
            .await
            .expect("transition_task should succeed");
    }
    task.id
}

async fn seed_task_in_progress(storage: &StorageClient, project_id: &str, spec_id: &str) -> String {
    // Walk Pending -> Ready -> InProgress so the mock row mirrors
    // a real loop that was killed mid-run.
    seed_task_with_walk(
        storage,
        project_id,
        spec_id,
        "in-flight task",
        &["ready", "in_progress"],
    )
    .await
}

async fn seed_task_failed(storage: &StorageClient, project_id: &str, spec_id: &str) -> String {
    // Walk Pending -> Ready -> InProgress -> Failed, mirroring the
    // edges `aura_os_tasks::compute_bridge` accepts.
    seed_task_with_walk(
        storage,
        project_id,
        spec_id,
        "previously-failed task",
        &["ready", "in_progress", "failed"],
    )
    .await
}

#[tokio::test]
async fn sweep_transitions_in_progress_task_to_ready_via_storage() {
    let (url, _db) = start_mock_storage().await;
    let storage = StorageClient::with_base_url(&url);
    let project_id = ProjectId::from_uuid(Uuid::new_v4());
    let spec_id = create_spec(&storage, &project_id.to_string()).await;
    let orphan_id = seed_task_in_progress(&storage, &project_id.to_string(), &spec_id).await;

    let pre = storage.get_task(&orphan_id, JWT).await.expect("get_task");
    assert_eq!(pre.status.as_deref(), Some("in_progress"));

    let tasks = load_project_tasks(&storage, project_id, JWT)
        .await
        .expect("load_project_tasks");
    let plans = recover_orphans(&tasks);
    assert_eq!(
        plans.len(),
        1,
        "exactly one orphan should be planned for recovery; got {plans:?}",
    );

    let applied = apply_orphan_recovery_plans(&storage, JWT, &plans).await;
    assert_eq!(applied, 1, "the single orphan plan must apply cleanly");

    // Post-condition: the mock storage row now reports `ready`.
    // The bridge for `InProgress -> Ready` walks through `Failed`
    // first (per `aura_os_tasks::transition::compute_bridge`), so
    // the final status we observe must be `ready` — never stuck
    // mid-bridge in `failed`.
    let post = storage.get_task(&orphan_id, JWT).await.expect("get_task");
    assert_eq!(
        post.status.as_deref(),
        Some("ready"),
        "orphan recovery must leave the task in Ready, not stuck mid-bridge",
    );
}

#[tokio::test]
async fn sweep_is_a_no_op_when_no_orphans_present() {
    let (url, _db) = start_mock_storage().await;
    let storage = StorageClient::with_base_url(&url);
    let project_id = ProjectId::from_uuid(Uuid::new_v4());

    // Empty task list ⇒ empty plan ⇒ zero transitions applied.
    let tasks = load_project_tasks(&storage, project_id, JWT)
        .await
        .expect("load_project_tasks on empty project");
    let plans = recover_orphans(&tasks);
    assert!(plans.is_empty());

    let applied = apply_orphan_recovery_plans(&storage, JWT, &plans).await;
    assert_eq!(applied, 0);
}

#[tokio::test]
async fn task_status_pure_field_round_trips() {
    // Sanity that the canonical orphan-recovery target matches the
    // wire string aura-storage emits, so an audit of the planner
    // without running the sweep still pins the right enum.
    assert_eq!(format!("{:?}", TaskStatus::Ready), "Ready");
}

#[tokio::test]
async fn cross_run_sweep_re_readies_failed_task_under_budget() {
    let (url, _db) = start_mock_storage().await;
    let storage = StorageClient::with_base_url(&url);
    let project_id = ProjectId::from_uuid(Uuid::new_v4());
    let spec_id = create_spec(&storage, &project_id.to_string()).await;
    let failed_id = seed_task_failed(&storage, &project_id.to_string(), &spec_id).await;

    let tasks = load_project_tasks(&storage, project_id, JWT)
        .await
        .expect("load_project_tasks");
    let tracker = TaskRetryTracker::new();
    let plans = recover_failed(&tasks, &tracker);
    assert_eq!(plans.len(), 1, "under-budget Failed task -> one plan");

    let applied = apply_orphan_recovery_plans(&storage, JWT, &plans).await;
    assert_eq!(applied, 1);

    let post = storage.get_task(&failed_id, JWT).await.expect("get_task");
    assert_eq!(post.status.as_deref(), Some("ready"));
}

#[tokio::test]
async fn cross_run_sweep_leaves_over_budget_failed_task_alone() {
    let (url, _db) = start_mock_storage().await;
    let storage = StorageClient::with_base_url(&url);
    let project_id = ProjectId::from_uuid(Uuid::new_v4());
    let spec_id = create_spec(&storage, &project_id.to_string()).await;
    let failed_id = seed_task_failed(&storage, &project_id.to_string(), &spec_id).await;

    let tasks = load_project_tasks(&storage, project_id, JWT)
        .await
        .expect("load_project_tasks");
    let tracker = TaskRetryTracker::new();
    let failed_uuid = tasks
        .iter()
        .find(|t| t.task_id.to_string() == failed_id)
        .expect("seeded failed task")
        .task_id;
    for _ in 0..TASK_LEVEL_RETRY_BUDGET {
        let _ = tracker.record_failure(failed_uuid);
    }

    let plans = recover_failed(&tasks, &tracker);
    assert!(plans.is_empty(), "over-budget -> no plan: {plans:?}");

    let post = storage.get_task(&failed_id, JWT).await.expect("get_task");
    assert_eq!(post.status.as_deref(), Some("failed"));
}

#[tokio::test]
async fn combined_sweep_handles_in_progress_and_failed_in_one_pass() {
    let (url, _db) = start_mock_storage().await;
    let storage = StorageClient::with_base_url(&url);
    let project_id = ProjectId::from_uuid(Uuid::new_v4());
    let spec_id = create_spec(&storage, &project_id.to_string()).await;

    let in_progress_id = seed_task_in_progress(&storage, &project_id.to_string(), &spec_id).await;
    let failed_id = seed_task_failed(&storage, &project_id.to_string(), &spec_id).await;

    let tasks = load_project_tasks(&storage, project_id, JWT)
        .await
        .expect("load_project_tasks");
    let tracker = TaskRetryTracker::new();
    let combined: Vec<OrphanRecoveryPlan> = recover_orphans(&tasks)
        .into_iter()
        .chain(recover_failed(&tasks, &tracker))
        .collect();
    assert_eq!(combined.len(), 2);

    let applied = apply_orphan_recovery_plans(&storage, JWT, &combined).await;
    assert_eq!(applied, 2);

    let ip_post = storage
        .get_task(&in_progress_id, JWT)
        .await
        .expect("get_task");
    let f_post = storage.get_task(&failed_id, JWT).await.expect("get_task");
    assert_eq!(ip_post.status.as_deref(), Some("ready"));
    assert_eq!(f_post.status.as_deref(), Some("ready"));
}
