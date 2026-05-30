//! Integration test for the ephemeral-executor startup janitor.
//!
//! Phase 2 of the concurrent-agent-loops work allocates a fresh
//! `Executor`-roled `project_agents` row for every ad-hoc task run so
//! that parallel runs in one project don't clobber each other in
//! `automaton_registry`. The per-run reaper inside
//! `dev_loop::adapter::run_single_task` deletes the row on terminal
//! status — but a server crash between "registry cleared" and "storage
//! deleted" (or between allocation and the reaper spawning) would
//! orphan the row.
//!
//! `purge_executor_instances_in_project`, called once at server boot
//! by `spawn_executor_janitor` in `app_builder.rs`, sweeps any such
//! orphans. This test pins the contract so a future role-enum
//! refactor can't accidentally let `Chat` / `Loop` rows fall into the
//! sweep.

mod common;

use aura_os_storage::CreateProjectAgentRequest;
use axum::http::StatusCode;
use common::*;
use tower::ServiceExt;

const JWT: &str = "test-token";

fn make_agent_req(role: Option<&str>, name: &str) -> CreateProjectAgentRequest {
    CreateProjectAgentRequest {
        agent_id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        org_id: None,
        role: Some("developer".into()),
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        instance_role: role.map(str::to_string),
        source: None,
        permissions: None,
        intent_classifier: None,
    }
}

#[tokio::test]
async fn purge_executor_instances_keeps_persistent_roles_alive() {
    let (_app, state, storage, _db) = build_test_app_with_storage().await;

    let project_id = uuid::Uuid::new_v4().to_string();

    let make = |role: Option<&str>, name: &str| CreateProjectAgentRequest {
        agent_id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        org_id: None,
        role: Some("developer".into()),
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        instance_role: role.map(str::to_string),
        source: None,
        permissions: None,
        intent_classifier: None,
    };

    let chat = storage
        .create_project_agent(&project_id, JWT, &make(Some("chat"), "Chat"))
        .await
        .expect("seed chat instance");
    let loop_inst = storage
        .create_project_agent(&project_id, JWT, &make(Some("loop"), "Loop"))
        .await
        .expect("seed loop instance");
    let exec_a = storage
        .create_project_agent(&project_id, JWT, &make(Some("executor"), "Executor A"))
        .await
        .expect("seed executor a");
    let exec_b = storage
        .create_project_agent(&project_id, JWT, &make(Some("executor"), "Executor B"))
        .await
        .expect("seed executor b");

    let pid: aura_os_core::ProjectId = project_id.parse().expect("parseable project id");

    let purged = state
        .agent_instance_service
        .purge_executor_instances_in_project(&pid)
        .await
        .expect("purge should succeed against in-memory storage");
    assert_eq!(
        purged, 2,
        "both seeded executor rows must be reclaimed by the janitor"
    );

    let remaining = storage
        .list_project_agents(&project_id, JWT)
        .await
        .expect("list survivors")
        .into_iter()
        .map(|spa| spa.id)
        .collect::<Vec<_>>();
    assert!(
        remaining.contains(&chat.id),
        "Chat instance must survive the executor sweep"
    );
    assert!(
        remaining.contains(&loop_inst.id),
        "Loop instance must survive the executor sweep"
    );
    assert!(
        !remaining.contains(&exec_a.id),
        "Executor A should have been deleted"
    );
    assert!(
        !remaining.contains(&exec_b.id),
        "Executor B should have been deleted"
    );
}

#[tokio::test]
async fn purge_executor_instances_is_idempotent_on_empty_project() {
    // A project with no agent instances at all (or no Executor-role
    // ones) must complete a sweep with `Ok(0)` and zero side effects.
    // This covers the bootstrap path on a fresh user account.
    let (_app, state, _storage, _db) = build_test_app_with_storage().await;
    let pid = aura_os_core::ProjectId::new();
    let purged = state
        .agent_instance_service
        .purge_executor_instances_in_project(&pid)
        .await
        .expect("empty-project sweep should not error");
    assert_eq!(purged, 0);
}

#[tokio::test]
async fn purge_reclaims_ledger_executor_even_when_storage_reports_chat() {
    // Reproduces the dev-run pileup: storage dropped the `instance_role`
    // column, so an ephemeral executor row comes back looking like a
    // plain Chat row. The role-based scan can't see it; only the local
    // ledger can. The janitor must still reclaim it while leaving a
    // genuine Chat row untouched.
    let (_app, state, storage, _db) = build_test_app_with_storage().await;
    let project_id = uuid::Uuid::new_v4().to_string();
    let pid: aura_os_core::ProjectId = project_id.parse().expect("parseable project id");

    let chat = storage
        .create_project_agent(&project_id, JWT, &make_agent_req(Some("chat"), "Real Chat"))
        .await
        .expect("seed chat instance");
    let ghost = storage
        .create_project_agent(
            &project_id,
            JWT,
            // No `instance_role` / `source`: storage stripped them.
            &make_agent_req(None, "Summarize This Me"),
        )
        .await
        .expect("seed stripped executor");
    let ghost_id: aura_os_core::AgentInstanceId = ghost.id.parse().expect("parseable ghost id");

    state
        .agent_instance_service
        .record_system_instance(&pid, &ghost_id, aura_os_core::AgentInstanceRole::Executor)
        .await;

    let purged = state
        .agent_instance_service
        .purge_executor_instances_in_project(&pid)
        .await
        .expect("ledger-driven purge should succeed");
    assert_eq!(
        purged, 1,
        "the ledger-tracked executor must be reclaimed even though storage reports it as Chat"
    );

    let remaining = storage
        .list_project_agents(&project_id, JWT)
        .await
        .expect("list survivors")
        .into_iter()
        .map(|spa| spa.id)
        .collect::<Vec<_>>();
    assert!(
        remaining.contains(&chat.id),
        "a real chat row must survive the ledger sweep"
    );
    assert!(
        !remaining.contains(&ghost.id),
        "the stripped executor row must be deleted via the ledger"
    );
    assert!(
        state
            .agent_instance_service
            .system_instance_ids(&pid)
            .is_empty(),
        "the ledger entry must be cleared once its row is deleted"
    );
}

#[tokio::test]
async fn list_agent_instances_excludes_ledger_tracked_system_rows() {
    // Even before cleanup runs, the list endpoint must hide ledgered
    // infrastructure rows so they never render in the projects sidebar,
    // regardless of whether storage echoed `instance_role` / `source`.
    let (app, state, storage, _db) = build_test_app_with_storage().await;
    let project_id = uuid::Uuid::new_v4().to_string();
    let pid: aura_os_core::ProjectId = project_id.parse().expect("parseable project id");

    storage
        .create_project_agent(&project_id, JWT, &make_agent_req(Some("chat"), "Real Chat"))
        .await
        .expect("seed chat instance");
    let ghost = storage
        .create_project_agent(&project_id, JWT, &make_agent_req(None, "Summarize This Me"))
        .await
        .expect("seed stripped executor");
    let ghost_id: aura_os_core::AgentInstanceId = ghost.id.parse().expect("parseable ghost id");
    state
        .agent_instance_service
        .record_system_instance(&pid, &ghost_id, aura_os_core::AgentInstanceRole::Executor)
        .await;

    let response = app
        .oneshot(json_request(
            "GET",
            &format!("/api/projects/{project_id}/agents"),
            None,
        ))
        .await
        .expect("list request");
    assert_eq!(response.status(), StatusCode::OK);

    let body = response_json(response).await;
    let names: Vec<String> = body
        .as_array()
        .expect("list returns an array")
        .iter()
        .filter_map(|entry| entry.get("name").and_then(|n| n.as_str()).map(String::from))
        .collect();

    assert!(
        names.iter().any(|n| n == "Real Chat"),
        "the genuine chat agent must remain visible: {names:?}"
    );
    assert!(
        !names.iter().any(|n| n == "Summarize This Me"),
        "the ledger-tracked executor must be filtered from the sidebar list: {names:?}"
    );
}
