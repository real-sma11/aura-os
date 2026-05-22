//! Integration test for filtering zero-event sessions out of
//! `GET /api/projects/:p/sessions` and
//! `GET /api/projects/:p/agents/:a/sessions`.
//!
//! Sessions get created in storage *before* the first user message is
//! persisted (see `create_new_chat_session` in
//! `apps/aura-os-server/src/handlers/agents/chat/persist.rs`), so any
//! race or persist failure on the very first turn leaves an orphan
//! row with no events. Plus there's pre-`lazy-+` legacy data in
//! storage from before the chat-input "+" became lazy. These would
//! render in the chats sidekick as unclickable "New chat" rows; the
//! API now drops them.
//!
//! As of aura-storage migration `0014_add_session_event_tracking`,
//! the empty-row filter lives in aura-storage itself: the public
//! list endpoints select on `event_count > 0`, maintained by the
//! `session_events_after_insert` trigger. aura-os-server is a
//! straight pass-through (no per-session `list_events?limit=1`
//! probes), and these tests verify the through-pass behavior against
//! the in-memory mock which mirrors that filter.

mod common;

use axum::http::StatusCode;
use axum::Router;
use serde_json::Value;
use tower::ServiceExt;

use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest, StorageClient,
};

use common::*;

async fn seed_project_agent(
    storage: &StorageClient,
    project_id: &str,
) -> aura_os_storage::StorageProjectAgent {
    storage
        .create_project_agent(
            project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Test Agent".into(),
                org_id: None,
                role: Some("developer".into()),
                personality: None,
                system_prompt: None,
                skills: None,
                icon: None,
                harness: None,
                instance_role: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent")
}

async fn seed_session(
    storage: &StorageClient,
    project_id: &str,
    project_agent_id: &str,
) -> aura_os_storage::StorageSession {
    storage
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
        .expect("create session")
}

async fn seed_user_event(storage: &StorageClient, session_id: &str) {
    storage
        .create_event(
            session_id,
            TEST_JWT,
            &CreateSessionEventRequest {
                session_id: Some(session_id.into()),
                user_id: None,
                agent_id: None,
                sender: Some("user".into()),
                project_id: None,
                org_id: None,
                event_type: "user_message".into(),
                content: Some(serde_json::json!({ "text": "hi" })),
            },
        )
        .await
        .expect("create event");
}

async fn fetch_session_ids(app: &Router, uri: &str) -> Vec<String> {
    let resp = app
        .clone()
        .oneshot(json_request("GET", uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "GET {uri}");
    let body = response_json(resp).await;
    let arr = body.as_array().expect("array of sessions");
    arr.iter()
        .map(|s| {
            s.get("session_id")
                .and_then(Value::as_str)
                .expect("session_id string")
                .to_string()
        })
        .collect()
}

#[tokio::test]
async fn list_project_sessions_filters_sessions_with_no_events() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa = seed_project_agent(&storage, &project_id).await;

    let with_events = seed_session(&storage, &project_id, &pa.id).await;
    let empty = seed_session(&storage, &project_id, &pa.id).await;
    seed_user_event(&storage, &with_events.id).await;

    let ids = fetch_session_ids(&app, &format!("/api/projects/{project_id}/sessions")).await;
    assert!(ids.contains(&with_events.id), "session with events stays");
    assert!(
        !ids.contains(&empty.id),
        "session with no events filtered out, got {ids:?}",
    );
}

#[tokio::test]
async fn list_sessions_filters_sessions_with_no_events() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa = seed_project_agent(&storage, &project_id).await;

    let with_events = seed_session(&storage, &project_id, &pa.id).await;
    let empty = seed_session(&storage, &project_id, &pa.id).await;
    seed_user_event(&storage, &with_events.id).await;

    let pa_id = pa.id.clone();
    let ids = fetch_session_ids(
        &app,
        &format!("/api/projects/{project_id}/agents/{pa_id}/sessions"),
    )
    .await;
    assert_eq!(
        ids,
        vec![with_events.id.clone()],
        "only the session with events remains (empty {} filtered)",
        empty.id,
    );
}

// The previous `list_sessions_keeps_rows_when_events_probe_errors`
// test verified fail-open behavior of `filter_nonempty_sessions` in
// aura-os-server. That probe is gone — aura-storage filters
// `event_count > 0` directly via the `idx_sessions_pa_recent` /
// `idx_sessions_project_recent` partial indexes (migration 0014), so
// there is no probe round-trip that could fail. If aura-storage's
// list endpoint itself errors, the entire list call propagates the
// upstream error to the UI, which is the correct behavior: the
// sidekick should refuse to render rather than render half-truth.
