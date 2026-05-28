//! `GET /api/projects/:project_id/tasks/:task_id/context-usage` —
//! task-scoped variant of the agent context-usage endpoints.
//!
//! Walks the persisted session events for the task's session newest-first
//! and returns the first `assistant_message_end` whose `content.task_id`
//! matches the requested task and whose `usage.context_utilization` is
//! finite. Mirrors the parsing in
//! [`crate::handlers::agents::sessions::latest_context_usage_for_session`]
//! but filters by `task_id` so a session that ran multiple tasks doesn't
//! return another task's last turn.
//!
//! Used by the frontend `TaskHeaderContextUsage` widget so the per-task
//! context pill in the sidekick task head can hydrate without waiting
//! for a fresh `AssistantMessageEnd` event — e.g. after a page reload
//! or when opening the Task Preview for a task that finished in a
//! prior session.

use axum::extract::{Path, State};
use axum::Json;
use tracing::warn;

use aura_os_core::{ProjectId, TaskId};
use aura_protocol::ContextBreakdown;

use crate::error::ApiResult;
use crate::handlers::agents::sessions::ContextUsageResponse;
use crate::state::{AppState, AuthJwt};

/// Resolve the storage session id for `task_id`, preferring the in-memory
/// `task_output_cache` stamp (live runs) and falling back to the persisted
/// `tasks` row (cold reads). Mirrors the fallback chain used by
/// `get_task_output`.
async fn resolve_task_session_id(
    state: &AppState,
    project_id: ProjectId,
    task_id: TaskId,
    jwt: &str,
) -> Option<String> {
    if let Some(cached) = state
        .task_output_cache
        .lock()
        .await
        .get(&(project_id, task_id))
        .and_then(|entry| entry.session_id.clone())
    {
        return Some(cached);
    }

    let storage = state.storage_client.as_ref()?;
    match storage.get_task(&task_id.to_string(), jwt).await {
        Ok(task) => task.session_id,
        Err(err) => {
            warn!(
                %task_id,
                error = %err,
                "task context-usage: get_task failed; cannot resolve session_id",
            );
            None
        }
    }
}

/// Pull the most recent `assistant_message_end` event for this task from
/// the session's persisted events and decode its `usage.context_*` fields
/// into a [`ContextUsageResponse`]. Returns `None` when the session has
/// no qualifying event for the task (e.g. the harness never reported
/// usage, or `context_utilization` was missing / non-finite).
async fn latest_context_usage_for_task(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    session_id: &str,
    task_id_str: &str,
) -> Option<ContextUsageResponse> {
    let events = match storage.list_events(session_id, jwt, None, None).await {
        Ok(events) => events,
        Err(err) => {
            warn!(
                %session_id,
                error = %err,
                "task context-usage: list_events failed",
            );
            return None;
        }
    };

    events
        .iter()
        .rev()
        .filter(|evt| evt.event_type.as_deref() == Some("assistant_message_end"))
        .filter(|evt| {
            evt.content
                .as_ref()
                .and_then(|c| c.get("task_id"))
                .and_then(|v| v.as_str())
                .is_some_and(|id| id == task_id_str)
        })
        .find_map(|evt| {
            let content = evt.content.as_ref()?;
            let usage = content.get("usage")?;
            let raw = usage.get("context_utilization").and_then(|v| v.as_f64())?;
            if !raw.is_finite() {
                return None;
            }
            let estimated_context_tokens = usage
                .get("estimated_context_tokens")
                .and_then(|v| v.as_u64());
            let context_breakdown = usage
                .get("context_breakdown")
                .and_then(|cb| serde_json::from_value::<ContextBreakdown>(cb.clone()).ok())
                .filter(|cb| !cb.is_empty());
            Some(ContextUsageResponse {
                context_utilization: raw as f32,
                estimated_context_tokens,
                context_breakdown,
            })
        })
}

/// Empty response used when storage is unavailable, the task has no
/// session, or the session has no usage-carrying turn yet. Matches the
/// frontend's `utilization <= 0` "no value" guard so the pill stays
/// hidden client-side without special-casing nullability.
fn empty_response() -> ContextUsageResponse {
    ContextUsageResponse {
        context_utilization: 0.0,
        estimated_context_tokens: None,
        context_breakdown: None,
    }
}

pub(crate) async fn get_task_context_usage(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<ContextUsageResponse>> {
    let Some(session_id) = resolve_task_session_id(&state, project_id, task_id, &jwt).await else {
        return Ok(Json(empty_response()));
    };

    let Some(storage) = state.storage_client.as_ref() else {
        return Ok(Json(empty_response()));
    };

    let response = latest_context_usage_for_task(storage, &jwt, &session_id, &task_id.to_string())
        .await
        .unwrap_or_else(empty_response);
    Ok(Json(response))
}
