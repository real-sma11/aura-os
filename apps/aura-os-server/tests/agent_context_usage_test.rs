//! Integration coverage for `GET /api/agents/:agent_id/context-usage`
//! (and its project-scoped twin) — specifically that the response now
//! plumbs the per-bucket `context_breakdown` from the most recent
//! persisted `assistant_message_end` event so the bottom-bar Context
//! popover renders the new stacked-bar view immediately on chat mount
//! instead of showing the legacy "Used / Total" card until the next
//! assistant turn arrives.
//!
//! The bug this guards against: prior to this fix the endpoint returned
//! only `context_utilization` + `estimated_context_tokens`, so the
//! frontend's hydration path seeded the store with `breakdown=undefined`
//! and `ContextUsageIndicator` rendered the legacy popover (the one
//! pictured in the user's screenshot showing "Context: 5% used / Used:
//! 9,467 tokens / Total: 200,000 tokens").
//!
//! Three cases:
//!
//! 1. A non-empty breakdown on the latest event flows through to the
//!    response untouched.
//! 2. An all-zero breakdown is dropped (treated as "not available")
//!    so older harness builds keep falling back to the legacy popover.
//! 3. A missing `context_breakdown` field is dropped (same fallback).

mod common;

use axum::http::StatusCode;
use serde_json::{json, Value};
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
                name: "Ctx Agent".into(),
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

async fn seed_session_with_assistant_end(
    storage: &StorageClient,
    project_agent_id: &str,
    project_id: &str,
    usage_payload: Value,
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
                sender: Some("assistant".into()),
                project_id: Some(project_id.into()),
                org_id: None,
                event_type: "assistant_message_end".into(),
                content: Some(json!({ "usage": usage_payload })),
            },
        )
        .await
        .expect("create assistant_message_end event");

    session.id
}

async fn fetch_context_usage(app: &axum::Router, agent_id: &AgentId) -> Value {
    let resp = app
        .clone()
        .oneshot(json_request(
            "GET",
            &format!("/api/agents/{agent_id}/context-usage"),
            None,
        ))
        .await
        .expect("request");
    assert_eq!(resp.status(), StatusCode::OK, "GET /context-usage");
    response_json(resp).await
}

#[tokio::test]
async fn context_usage_endpoint_forwards_non_empty_breakdown() {
    let (app, state, storage, _db) = build_test_app_with_storage().await;

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Context Breakdown Hydrate".into(),
            description: "Regression: breakdown must reach the chat-mount hydrate".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

    let agent_id = AgentId::new();
    let pa = seed_project_agent(&storage, &project.project_id.to_string(), &agent_id).await;

    seed_session_with_assistant_end(
        &storage,
        &pa.id,
        &project.project_id.to_string(),
        json!({
            "context_utilization": 0.42_f64,
            "estimated_context_tokens": 84_000_u64,
            "context_breakdown": {
                "system_prompt_tokens": 4_000,
                "tools_tokens": 6_500,
                "skills_tokens": 1_200,
                "mcp_tokens": 0,
                "subagents_tokens": 800,
                "conversation_tokens": 71_500,
            },
        }),
    )
    .await;

    let body = fetch_context_usage(&app, &agent_id).await;

    assert!(
        (body["context_utilization"].as_f64().unwrap() - 0.42).abs() < 1e-4,
        "utilization should round-trip; got {body}",
    );
    assert_eq!(body["estimated_context_tokens"], json!(84_000));

    let cb = body
        .get("context_breakdown")
        .expect("response must carry context_breakdown when the latest event had one");
    assert_eq!(cb["system_prompt_tokens"], json!(4_000));
    assert_eq!(cb["tools_tokens"], json!(6_500));
    assert_eq!(cb["skills_tokens"], json!(1_200));
    assert_eq!(cb["mcp_tokens"], json!(0));
    assert_eq!(cb["subagents_tokens"], json!(800));
    assert_eq!(cb["conversation_tokens"], json!(71_500));
}

#[tokio::test]
async fn context_usage_endpoint_drops_all_zero_breakdown() {
    // Older harness builds emit `ContextBreakdown::default()` (every
    // bucket = 0). The server must treat that as "not available" so
    // the frontend stays on its legacy popover branch via the existing
    // `breakdown == null` guard. Otherwise the new stacked-bar would
    // render an empty bar and a confusing "0 tokens" row per bucket.
    let (app, state, storage, _db) = build_test_app_with_storage().await;

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Context Breakdown Empty".into(),
            description: "All-zero breakdown must drop to legacy fallback".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

    let agent_id = AgentId::new();
    let pa = seed_project_agent(&storage, &project.project_id.to_string(), &agent_id).await;

    seed_session_with_assistant_end(
        &storage,
        &pa.id,
        &project.project_id.to_string(),
        json!({
            "context_utilization": 0.05_f64,
            "estimated_context_tokens": 9_467_u64,
            "context_breakdown": {
                "system_prompt_tokens": 0,
                "tools_tokens": 0,
                "skills_tokens": 0,
                "mcp_tokens": 0,
                "subagents_tokens": 0,
                "conversation_tokens": 0,
            },
        }),
    )
    .await;

    let body = fetch_context_usage(&app, &agent_id).await;
    assert_eq!(body["estimated_context_tokens"], json!(9_467));
    assert!(
        body.get("context_breakdown").is_none(),
        "all-zero breakdown should be elided so the frontend falls back",
    );
}

#[tokio::test]
async fn context_usage_endpoint_omits_breakdown_when_event_lacks_it() {
    // Pre-upgrade harness builds don't emit `context_breakdown` at all;
    // the field is `#[serde(default)]` on the Rust side so deserialization
    // succeeds with `ContextBreakdown::default()`. The server's `is_empty`
    // filter is what keeps the response clean — verify directly.
    let (app, state, storage, _db) = build_test_app_with_storage().await;

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Context Breakdown Missing".into(),
            description: "Missing breakdown field must drop to legacy fallback".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

    let agent_id = AgentId::new();
    let pa = seed_project_agent(&storage, &project.project_id.to_string(), &agent_id).await;

    seed_session_with_assistant_end(
        &storage,
        &pa.id,
        &project.project_id.to_string(),
        json!({
            "context_utilization": 0.18_f64,
            "estimated_context_tokens": 36_000_u64,
        }),
    )
    .await;

    let body = fetch_context_usage(&app, &agent_id).await;
    assert_eq!(body["estimated_context_tokens"], json!(36_000));
    assert!(
        body.get("context_breakdown").is_none(),
        "missing breakdown field should yield no `context_breakdown` in the response",
    );
}
