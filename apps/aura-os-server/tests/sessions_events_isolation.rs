//! Integration coverage for the per-session standalone-agent events
//! endpoint added in Phase 4 of the agent-stuck-and-reset fix series.
//!
//! `GET /api/agents/:agent_id/sessions/:session_id/events` is the
//! sister of the project-scoped
//! `/api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id/events`
//! handler (`agents/sessions.rs::list_session_events`). Its job is to
//! return ONLY the events that belong to the requested session id —
//! never to fall back to the per-agent timeline that aggregates
//! across every session of the agent. Without that guarantee, the
//! standalone chat panel's `+ new chat` press silently rehydrates
//! the prior session's transcript on the next history fetch, which
//! is the user-visible bug Phase 4 closes.
//!
//! These tests stand up the in-memory mock storage, seed two
//! sessions on the same standalone agent (each with a distinguishable
//! marker event), and assert:
//!
//! 1. Per-session GET for session A returns A's events only.
//! 2. Per-session GET for session B returns B's events only.
//! 3. Per-session GET for a session that belongs to a *different*
//!    agent returns 404 (ownership check) — protects against probing.

mod common;

use axum::http::StatusCode;
use serde_json::Value;
use tower::ServiceExt;

use aura_os_core::*;
use aura_os_projects::CreateProjectInput;
use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest, StorageClient,
};

use common::*;

async fn seed_project_agent(
    storage: &StorageClient,
    project_id: &str,
    agent_id: &AgentId,
) -> aura_os_storage::StorageProjectAgent {
    storage
        .create_project_agent(
            project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "Iso Agent".into(),
                org_id: None,
                role: Some("Researcher".into()),
                instance_role: None,
                source: None,
                personality: None,
                system_prompt: None,
                skills: Some(vec![]),
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent")
}

async fn seed_session_with_user_text(
    storage: &StorageClient,
    project_agent_id: &str,
    project_id: &str,
    text: &str,
) -> String {
    let session = storage
        .create_session(
            project_agent_id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project_id.into(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");

    storage
        .create_event(
            &session.id,
            TEST_JWT,
            &CreateSessionEventRequest {
                session_id: Some(session.id.clone()),
                user_id: None,
                agent_id: Some(project_agent_id.into()),
                sender: Some("user".into()),
                project_id: Some(project_id.into()),
                org_id: None,
                event_type: "user_message".into(),
                content: Some(serde_json::json!({ "text": text })),
            },
        )
        .await
        .expect("create user event");

    session.id
}

async fn fetch_event_texts(app: &axum::Router, uri: &str) -> Vec<String> {
    let resp = app
        .clone()
        .oneshot(json_request("GET", uri, None))
        .await
        .expect("request");
    assert_eq!(resp.status(), StatusCode::OK, "GET {uri}");
    let body = response_json(resp).await;
    let arr = body.as_array().expect("response should be an array");
    arr.iter()
        .map(|e| {
            e.get("content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        })
        .collect()
}

#[tokio::test]
async fn per_session_endpoint_returns_only_requested_session_events() {
    let (app, state, storage, _db) = build_test_app_with_storage().await;

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Per-Session Iso".into(),
            description: "Phase 4 regression: reset must actually reset".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

    let agent_id = AgentId::new();
    let project_agent =
        seed_project_agent(&storage, &project.project_id.to_string(), &agent_id).await;

    let session_a = seed_session_with_user_text(
        &storage,
        &project_agent.id,
        &project.project_id.to_string(),
        "session A user marker",
    )
    .await;

    // Force a strictly-later timestamp on session B so any sort
    // tiebreak in `events_to_session_history` is deterministic.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    let session_b = seed_session_with_user_text(
        &storage,
        &project_agent.id,
        &project.project_id.to_string(),
        "session B user marker",
    )
    .await;

    let texts_a = fetch_event_texts(
        &app,
        &format!("/api/agents/{agent_id}/sessions/{session_a}/events"),
    )
    .await;
    assert_eq!(
        texts_a,
        vec!["session A user marker".to_string()],
        "per-session GET for session A must NOT leak session B events",
    );

    let texts_b = fetch_event_texts(
        &app,
        &format!("/api/agents/{agent_id}/sessions/{session_b}/events"),
    )
    .await;
    assert_eq!(
        texts_b,
        vec!["session B user marker".to_string()],
        "per-session GET for session B must NOT leak session A events",
    );
}

#[tokio::test]
async fn per_session_endpoint_404s_when_session_belongs_to_other_agent() {
    let (app, state, storage, _db) = build_test_app_with_storage().await;

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Per-Session Ownership".into(),
            description: "Phase 4: ownership check on per-session endpoint".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

    // Two distinct standalone-agent template ids, each with their
    // own project_agent binding under the same project, each with
    // one seeded session.
    let agent_alpha = AgentId::new();
    let agent_beta = AgentId::new();

    let pa_alpha =
        seed_project_agent(&storage, &project.project_id.to_string(), &agent_alpha).await;
    let pa_beta = seed_project_agent(&storage, &project.project_id.to_string(), &agent_beta).await;

    let session_alpha = seed_session_with_user_text(
        &storage,
        &pa_alpha.id,
        &project.project_id.to_string(),
        "alpha-only message",
    )
    .await;
    let _session_beta = seed_session_with_user_text(
        &storage,
        &pa_beta.id,
        &project.project_id.to_string(),
        "beta-only message",
    )
    .await;

    // Cross-agent probe: ask agent_beta for session_alpha. Must 404
    // — the response shape MUST NOT differentiate "session does not
    // exist" from "session belongs to a different agent" because
    // either answer leaks ownership of an id the caller doesn't own.
    let resp = app
        .clone()
        .oneshot(json_request(
            "GET",
            &format!("/api/agents/{agent_beta}/sessions/{session_alpha}/events"),
            None,
        ))
        .await
        .expect("request");
    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "cross-agent session probe must return 404",
    );
}

#[tokio::test]
async fn per_session_endpoint_honours_limit_query_param() {
    // Defensive coverage on `?limit=`: the chat panel passes
    // `STANDALONE_AGENT_HISTORY_LIMIT` (currently 80) to keep the
    // first paint small. With more events than the cap, the response
    // must return the most recent N rather than the first N.
    let (app, state, storage, _db) = build_test_app_with_storage().await;

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Per-Session Limit".into(),
            description: "Phase 4: limit query param truncates to most recent".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

    let agent_id = AgentId::new();
    let pa = seed_project_agent(&storage, &project.project_id.to_string(), &agent_id).await;

    let session = storage
        .create_session(
            &pa.id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project.project_id.to_string(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");

    for idx in 0..5 {
        storage
            .create_event(
                &session.id,
                TEST_JWT,
                &CreateSessionEventRequest {
                    session_id: Some(session.id.clone()),
                    user_id: None,
                    agent_id: Some(pa.id.clone()),
                    sender: Some("user".into()),
                    project_id: Some(project.project_id.to_string()),
                    org_id: None,
                    event_type: "user_message".into(),
                    content: Some(serde_json::json!({ "text": format!("evt-{idx}") })),
                },
            )
            .await
            .expect("create event");
        // Spread `created_at` so the chronological sort in
        // `events_to_session_history` produces a deterministic order.
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }

    let texts = fetch_event_texts(
        &app,
        &format!(
            "/api/agents/{agent_id}/sessions/{}/events?limit=2",
            session.id,
        ),
    )
    .await;

    assert_eq!(
        texts,
        vec!["evt-3".to_string(), "evt-4".to_string()],
        "limit must trim to the most recent N, not the oldest N",
    );
}
