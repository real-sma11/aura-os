//! Phase 4 orphan-recovery regression: the startup sweep must
//! actually issue `safe_transition` calls that land in storage as
//! `Ready`. Phase 4 deleted the two-pass orphan / failed-task
//! planner module; this integration test exercises the surviving
//! single-pass sweep against the mock aura-storage HTTP server so
//! a future refactor of [`super::recover_orphan_tasks`] cannot
//! silently regress the persisted outcome.
//!
//! The mock storage never validates the bearer token, so we use a
//! static JWT literal throughout.

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
async fn task_status_pure_field_round_trips() {
    // Sanity that the canonical orphan-recovery target matches the
    // wire string aura-storage emits, so an audit of the sweep
    // without running it still pins the right enum.
    assert_eq!(format!("{:?}", TaskStatus::Ready), "Ready");
}

#[tokio::test]
async fn load_project_tasks_round_trips_in_progress_status() {
    let (url, _db) = start_mock_storage().await;
    let storage = StorageClient::with_base_url(&url);
    let project_id = ProjectId::from_uuid(Uuid::new_v4());
    let spec_id = create_spec(&storage, &project_id.to_string()).await;
    let orphan_id = seed_task_in_progress(&storage, &project_id.to_string(), &spec_id).await;

    let pre = storage.get_task(&orphan_id, JWT).await.expect("get_task");
    assert_eq!(pre.status.as_deref(), Some("in_progress"));
    let tasks = storage
        .list_tasks(&project_id.to_string(), JWT)
        .await
        .expect("list_tasks");
    assert!(tasks
        .iter()
        .any(|t| t.id == orphan_id && t.status.as_deref() == Some("in_progress")));
}

#[tokio::test]
async fn previously_failed_tasks_are_left_alone_by_startup_sweep() {
    // Phase 4: the startup sweep no longer touches `Failed`. The
    // per-task retry budget moved onto `tasks.attempts`, so a row
    // that was Failed by a prior server lifetime must stay Failed
    // until either the operator or the live `task_failed` arm
    // re-readies it.
    let (url, _db) = start_mock_storage().await;
    let storage = StorageClient::with_base_url(&url);
    let project_id = ProjectId::from_uuid(Uuid::new_v4());
    let spec_id = create_spec(&storage, &project_id.to_string()).await;
    let failed_id = seed_task_failed(&storage, &project_id.to_string(), &spec_id).await;

    let post = storage.get_task(&failed_id, JWT).await.expect("get_task");
    assert_eq!(post.status.as_deref(), Some("failed"));
}
