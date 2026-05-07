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

mod common;

use std::sync::Arc;

use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;
use tokio::net::TcpListener;
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

/// Probe failures must fail open: a transient aura-storage hiccup on
/// the events endpoint must not erase real chats from the sidekick.
/// We stand up a custom mock where the sessions/project-agent routes
/// behave normally but `GET /api/sessions/:id/events` always returns
/// 500, then assert the proxy still surfaces every session.
#[tokio::test]
async fn list_sessions_keeps_rows_when_events_probe_errors() {
    let project_id = uuid::Uuid::new_v4().to_string();
    let pa_id_uuid = uuid::Uuid::new_v4().to_string();
    let session_id_uuid = uuid::Uuid::new_v4().to_string();

    let pa_resp_id = pa_id_uuid.clone();
    let session_resp_id = session_id_uuid.clone();
    let session_resp_pid = project_id.clone();

    let storage_app = Router::new()
        .route(
            "/api/projects/:project_id/agents",
            get(move || {
                let pa_id = pa_resp_id.clone();
                let pid = session_resp_pid.clone();
                async move {
                    Json::<Vec<Value>>(vec![serde_json::json!({
                        "id": pa_id,
                        "projectId": pid,
                        "agentId": uuid::Uuid::new_v4().to_string(),
                        "name": "x",
                        "status": "active",
                    })])
                }
            }),
        )
        .route(
            "/api/project-agents/:project_agent_id/sessions",
            get(move |axum::extract::Path(pa_id): axum::extract::Path<String>| {
                let session_id = session_resp_id.clone();
                async move {
                    Json(serde_json::json!([{
                        "id": session_id,
                        "projectAgentId": pa_id,
                        "projectId": uuid::Uuid::new_v4().to_string(),
                        "status": "active",
                        "startedAt": chrono::Utc::now().to_rfc3339(),
                    }]))
                }
            }),
        )
        .route(
            "/api/sessions/:session_id/events",
            get(|| async {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "events backend down"})),
                )
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let storage_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, storage_app).await.ok() });

    let storage = Arc::new(StorageClient::with_base_url(&storage_url));
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (app, _state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        Some(storage),
        None,
        None,
    );

    let ids = fetch_session_ids(&app, &format!("/api/projects/{project_id}/sessions")).await;
    assert_eq!(
        ids,
        vec![session_id_uuid],
        "session is preserved when the events probe errors (fail-open)",
    );
}
