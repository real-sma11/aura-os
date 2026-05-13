//! Integration tests for `SessionService::create_chat_followup_session`,
//! the chat-flavoured rollover entry point added in Phase 3 of the
//! agent-stream reliability plan. The chat path partitions sessions
//! by `project_agent_id` (not `AgentInstanceId`), so the existing
//! `rollover_session` API doesn't fit; this helper is the seam the
//! `resolve_chat_session_with_pin` path uses to mint a fresh session
//! at context-pressure.
//!
//! The higher-level "persist_task observes
//! `assistant_message_end.usage.context_utilization >= threshold` and
//! flags the storage row `rolled_over` + writes a `rollover_summary`
//! event" plumbing lives in `apps/aura-os-server` and is intertwined
//! with `AppState` / harness fixtures that are heavy to spin up here.
//
// TODO(phase-3-followup): integration test for persist_task auto-fork
// trigger — drive `run_persist_loop` with a synthetic
// `AssistantMessageEnd` carrying `context_utilization: 0.9` and
// assert the `MockStorageClient` observed an
// `UpdateSessionRequest { status: "rolled_over", ... }` PLUS a
// `create_event { event_type: "rollover_summary", ... }`.

mod common;

use std::sync::Arc;

use aura_os_core::*;
use aura_os_sessions::CreateSessionParams;

use common::*;

/// Happy path: `create_chat_followup_session` closes the previous
/// session (status=`rolled_over`, ended_at=now) and mints a fresh one
/// carrying `summary_of_previous_context` forward. The new session
/// also re-binds to the same `project_agent_id`, mirroring how
/// `resolve_chat_session_with_pin` would route the next user send.
#[tokio::test]
async fn create_chat_followup_session_closes_previous_and_carries_summary_forward() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.8);

    let pid = ProjectId::new();
    // Chat partitions sessions by `project_agent_id`, not by
    // `AgentInstanceId` like the dev-loop path. We use a stable
    // string here to mirror the `setup_*_chat_persistence` helpers in
    // `apps/aura-os-server`, which forward the binding's
    // `pa.id` / `agent_instance_id.to_string()` straight into the
    // storage URL path.
    let project_agent_id = "pa-chat-followup".to_string();

    // Seed the "previous" session via the existing create_session
    // entry point so we get a real storage id to roll over.
    let aiid = AgentInstanceId::new();
    let previous = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aiid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: Some("claude-opus-4".to_string()),
        })
        .await
        .expect("create_session should succeed");

    let new_id = svc
        .create_chat_followup_session(
            &pid,
            &project_agent_id,
            &previous.session_id,
            "Built the auth module. User then asked about pagination.".into(),
            Some("claude-opus-4".to_string()),
        )
        .await
        .expect("create_chat_followup_session should succeed");

    assert_ne!(
        new_id, previous.session_id,
        "fork must yield a session id distinct from the previous one"
    );

    let sessions = db.lock().await;
    let old = sessions
        .iter()
        .find(|s| s.id == previous.session_id.to_string())
        .expect("previous session should exist in storage");
    assert_eq!(
        old.status.as_deref(),
        Some("rolled_over"),
        "previous chat session must be marked rolled_over",
    );
    assert!(
        old.ended_at.is_some(),
        "previous chat session must have ended_at populated",
    );

    let new_session = sessions
        .iter()
        .find(|s| s.id == new_id.to_string())
        .expect("new chat session should exist in storage");
    assert_eq!(
        new_session.status.as_deref(),
        Some("active"),
        "new chat session must be active",
    );
    assert_eq!(
        new_session.summary_of_previous_context.as_deref(),
        Some("Built the auth module. User then asked about pagination."),
        "new chat session must carry the summary forward",
    );
}

/// Empty / whitespace summaries are dropped on the wire so the storage
/// row's `summary_of_previous_context` stays NULL — matching how
/// `SessionService::create_session` already treats the empty-string
/// case. Without this guard the chat panel would render a bare empty
/// quoted block on the next session's first turn.
#[tokio::test]
async fn create_chat_followup_session_drops_empty_summary() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.8);

    let pid = ProjectId::new();
    let project_agent_id = "pa-chat-empty-summary".to_string();
    let aiid = AgentInstanceId::new();

    let previous = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aiid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("create_session should succeed");

    let new_id = svc
        .create_chat_followup_session(
            &pid,
            &project_agent_id,
            &previous.session_id,
            // Whitespace-only summary should land as None on the
            // wire; the resolver substitutes a static fallback when
            // it observes the missing summary so the UX stays sane.
            "   ".into(),
            None,
        )
        .await
        .expect("create_chat_followup_session should succeed");

    let sessions = db.lock().await;
    let new_session = sessions
        .iter()
        .find(|s| s.id == new_id.to_string())
        .expect("new chat session should exist");
    assert!(
        new_session
            .summary_of_previous_context
            .as_deref()
            .map(|s| s.is_empty())
            .unwrap_or(true),
        "whitespace-only summaries must not persist a non-empty `summary_of_previous_context`",
    );
}
