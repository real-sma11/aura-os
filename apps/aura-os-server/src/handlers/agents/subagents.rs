//! Live subagent-thread surface.
//!
//! Two endpoints back the "live subagent threads" feature, which lets
//! the chat UI render a clickable thread card for each child run a
//! parent turn's `task` tool spawned, and stream that child's output
//! live:
//!
//! - `POST /api/streams/subagents/:child_run_id/attach` — attach to the
//!   already-registered child harness run, fan its frames into a
//!   resumable [`crate::live_streams`] entry, and return the minted
//!   `attach_id` the client passes to the existing
//!   `GET /api/streams/:attach_id` replay/tail endpoint.
//! - `GET  /api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id/subagents`
//!   — list the subagent threads spawned in a session, sourced from the
//!   `subagent_spawned` linkage events the persist task writes, folding
//!   in the most recent `subagent_status` per child run.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::info;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, SessionId};

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::live_streams::{StreamKind, StreamScope};
use crate::state::{AppState, AuthJwt, AuthSession};

/// Query string for the subagent-attach endpoint.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct SubagentAttachQuery {
    /// Originating parent `task` tool-use id, surfaced on the
    /// `subagent_spawned` event. Threaded onto the live-stream scope so
    /// the client can match the reattached thread to its tool card.
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,
}

/// Response from the subagent-attach endpoint.
#[derive(Debug, Serialize)]
pub(crate) struct SubagentAttachResponse {
    /// Opaque id the client passes to `GET /api/streams/:attach_id`.
    pub attach_id: String,
    /// Echoed back so the caller can correlate the response.
    pub child_run_id: String,
}

/// One row in the session-subagents listing.
#[derive(Debug, Serialize)]
pub(crate) struct SubagentThreadDto {
    pub child_run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
    pub subagent_type: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    /// Most recent `subagent_status.state` observed for this child run
    /// (`running`/`completed`/`failed`/…), or `None` when no status
    /// event has been persisted yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// `POST /api/streams/subagents/:child_run_id/attach`.
///
/// Attaches to the child run's `WS /stream/:child_run_id` event stream
/// (the harness registered the child run id when the parent `task` tool
/// spawned it) and registers it as a resumable live stream. We use the
/// owned-session [`crate::live_streams::LiveStreamRegistry::register`]
/// path (not `register_receiver`) because `attach_run` hands back a
/// fresh [`aura_os_harness::HarnessSession`] that owns its own upstream
/// WebSocket — the registry must hold the session alive until the child
/// run terminates, otherwise dropping it here would immediately tear
/// the child WS down.
pub(crate) async fn attach_subagent_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(child_run_id): Path<String>,
    Query(query): Query<SubagentAttachQuery>,
) -> ApiResult<Json<SubagentAttachResponse>> {
    info!(%child_run_id, "Subagent live-stream attach requested");

    // Child runs are spawned in-process by the parent turn's harness;
    // the local harness owns the `WS /stream/:run_id` surface. `false`
    // for `wait_for_ready` mirrors the automaton reattach path — a child
    // run never re-emits `SessionReady`.
    let harness = state.harness_for(HarnessMode::Local);
    let harness_session = harness
        .attach_run(&child_run_id, Some(&jwt), false)
        .await
        .map_err(|e| {
            ApiError::internal(format!("attaching to subagent run {child_run_id}: {e}"))
        })?;

    let scope = StreamScope {
        user_id: Some(session.user_id.clone()),
        project_id: None,
        agent_instance_id: None,
        session_id: None,
        parent_tool_use_id: query.parent_tool_use_id,
    };
    let live = state
        .live_streams
        .register(StreamKind::SubagentTurn, scope, harness_session);

    Ok(Json(SubagentAttachResponse {
        attach_id: live.attach_id.clone(),
        child_run_id,
    }))
}

/// `GET /api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id/subagents`.
///
/// Lists the subagent threads spawned in a session by scanning the
/// `subagent_spawned` linkage events the persist task writes, folding in
/// the latest `subagent_status` per child run.
pub(crate) async fn list_session_subagents(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<SubagentThreadDto>>> {
    let storage = state.require_storage_client()?;
    let events = storage
        .list_events(&session_id.to_string(), &jwt, None, None)
        .await
        .map_err(map_storage_error)?;

    Ok(Json(build_subagent_threads(&events)))
}

/// Build the subagent thread rows from a session's event list. Split
/// out for unit testing without a live storage backend.
fn build_subagent_threads(
    events: &[aura_os_storage::StorageSessionEvent],
) -> Vec<SubagentThreadDto> {
    // Collect the latest status per child run first so each spawned row
    // can fold in its most recent state.
    let mut latest_state: HashMap<String, String> = HashMap::new();
    for event in events {
        if event.event_type.as_deref() != Some("subagent_status") {
            continue;
        }
        let Some(content) = event.content.as_ref() else {
            continue;
        };
        let (Some(child_run_id), Some(child_state)) = (
            content.get("child_run_id").and_then(|v| v.as_str()),
            content.get("state").and_then(|v| v.as_str()),
        ) else {
            continue;
        };
        // Events arrive oldest→newest, so the last write wins.
        latest_state.insert(child_run_id.to_string(), child_state.to_string());
    }

    events
        .iter()
        .filter(|e| e.event_type.as_deref() == Some("subagent_spawned"))
        .filter_map(|event| {
            let content = event.content.as_ref()?;
            let child_run_id = content.get("child_run_id").and_then(|v| v.as_str())?;
            Some(SubagentThreadDto {
                child_run_id: child_run_id.to_string(),
                parent_tool_use_id: content
                    .get("parent_tool_use_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                subagent_type: content
                    .get("subagent_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                prompt: content
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                message_id: content
                    .get("message_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                state: latest_state.get(child_run_id).cloned(),
                created_at: event.created_at.clone(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_storage::StorageSessionEvent;
    use serde_json::json;

    fn event(event_type: &str, content: serde_json::Value) -> StorageSessionEvent {
        StorageSessionEvent {
            id: "evt".to_string(),
            session_id: Some("sess".to_string()),
            user_id: None,
            agent_id: None,
            sender: Some("agent".to_string()),
            project_id: None,
            org_id: None,
            event_type: Some(event_type.to_string()),
            content: Some(content),
            created_at: Some("2026-01-01T00:00:00Z".to_string()),
        }
    }

    #[test]
    fn build_threads_links_spawn_with_latest_status() {
        let events = vec![
            event(
                "subagent_spawned",
                json!({
                    "child_run_id": "child-1",
                    "parent_tool_use_id": "toolu_1",
                    "subagent_type": "explore",
                    "prompt": "look around",
                    "message_id": "msg-1",
                }),
            ),
            event(
                "subagent_status",
                json!({ "child_run_id": "child-1", "state": "running" }),
            ),
            event(
                "subagent_status",
                json!({ "child_run_id": "child-1", "state": "completed" }),
            ),
            // Unrelated event types are ignored.
            event("text_delta", json!({ "text": "hi" })),
        ];

        let threads = build_subagent_threads(&events);
        assert_eq!(threads.len(), 1, "exactly one spawned thread");
        let t = &threads[0];
        assert_eq!(t.child_run_id, "child-1");
        assert_eq!(t.parent_tool_use_id.as_deref(), Some("toolu_1"));
        assert_eq!(t.subagent_type, "explore");
        assert_eq!(
            t.state.as_deref(),
            Some("completed"),
            "latest status must win over the earlier `running`",
        );
    }

    #[test]
    fn build_threads_tolerates_spawn_without_status_or_parent_id() {
        let events = vec![event(
            "subagent_spawned",
            json!({
                "child_run_id": "child-2",
                "subagent_type": "shell",
                "prompt": "run it",
            }),
        )];
        let threads = build_subagent_threads(&events);
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].child_run_id, "child-2");
        assert!(threads[0].parent_tool_use_id.is_none());
        assert!(threads[0].state.is_none());
    }
}
