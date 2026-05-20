//! Read-side endpoints: list events for an agent or for a
//! project-bound agent instance, and the paginated cursor variant
//! used by the chat-window scroller.

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, SessionEvent, SessionId};
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use tracing::warn;

use crate::capture_auth::{
    demo_agent_events, demo_agent_id, demo_agent_instance_id, demo_project_id,
    is_capture_access_token,
};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::super::conversions::events_to_session_history;
use super::constants::MAX_AGENT_HISTORY_WINDOW_LIMIT;
use super::loaders::{load_latest_agent_events_from_storage_result, load_project_session_history};
use super::request::{
    apply_cursor_filter, normalize_agent_history_limit, slice_recent_agent_events,
    target_window_size, AgentEventsQuery, PaginatedEventsQuery, PaginatedEventsResponse,
};

pub(crate) async fn list_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    if is_capture_access_token(&jwt)
        && project_id == demo_project_id()
        && agent_instance_id == demo_agent_instance_id()
    {
        return Ok(Json(demo_agent_events()));
    }

    // Project-scoped UI endpoint has no explicit limit parameter yet, but
    // the `AgentChatView` currently renders at most the last
    // `MAX_AGENT_HISTORY_WINDOW_LIMIT` messages — cap the load so we don't
    // walk every historical session just to throw most of it away.
    let target_size = Some(MAX_AGENT_HISTORY_WINDOW_LIMIT);
    let messages = load_project_session_history(&state, &agent_instance_id, &jwt, target_size)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(messages))
}

pub(crate) async fn list_agent_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<AgentEventsQuery>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        return Ok(Json(slice_recent_agent_events(
            demo_agent_events(),
            query.limit,
            query.offset,
        )));
    }

    let _ = state.require_storage_client()?;
    let target_size = target_window_size(query.limit, query.offset);
    let messages =
        load_latest_agent_events_from_storage_result(&state, &agent_id, &jwt, target_size)
            .await
            .map_err(map_storage_error)?;
    Ok(Json(slice_recent_agent_events(
        messages,
        query.limit,
        query.offset,
    )))
}

pub(crate) async fn list_agent_events_paginated(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<PaginatedEventsQuery>,
) -> ApiResult<Json<PaginatedEventsResponse>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        let filtered = apply_cursor_filter(
            demo_agent_events(),
            query.before.as_deref(),
            query.after.as_deref(),
        );
        let limit = normalize_agent_history_limit(query.limit).unwrap_or(50);
        let has_more = filtered.len() > limit;
        let start = filtered.len().saturating_sub(limit);
        let result = filtered[start..].to_vec();
        let next_cursor = if has_more {
            result.first().map(|m| m.event_id.to_string())
        } else {
            None
        };
        return Ok(Json(PaginatedEventsResponse {
            events: result,
            has_more,
            next_cursor,
        }));
    }

    let _ = state.require_storage_client()?;
    // When either cursor is present we need the full transcript so the
    // `before`/`after` anchor can be located; otherwise we only need
    // enough events to fill the requested window.
    let target_size = if query.before.is_some() || query.after.is_some() {
        None
    } else {
        target_window_size(query.limit, 0)
    };
    let messages =
        load_latest_agent_events_from_storage_result(&state, &agent_id, &jwt, target_size)
            .await
            .map_err(map_storage_error)?;

    let filtered = apply_cursor_filter(messages, query.before.as_deref(), query.after.as_deref());

    let limit = normalize_agent_history_limit(query.limit).unwrap_or(50);

    let has_more = filtered.len() > limit;
    let start = filtered.len().saturating_sub(limit);
    let result = filtered[start..].to_vec();

    let next_cursor = if has_more {
        result.first().map(|m| m.event_id.to_string())
    } else {
        None
    };

    Ok(Json(PaginatedEventsResponse {
        events: result,
        has_more,
        next_cursor,
    }))
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct AgentSessionEventsQuery {
    /// Cap the response to the most recent N reconstructed events. Mirrors
    /// the `limit` semantics on `list_agent_events` so a chat panel that
    /// already knows how many rows it wants to render can avoid loading the
    /// whole transcript.
    pub limit: Option<usize>,
    /// Return only events whose `created_at` is strictly greater than
    /// `since` (RFC 3339 timestamp). Lets a long-running chat tail new
    /// rows incrementally without re-fetching the full history. When
    /// the timestamp fails to parse the filter is ignored — we treat
    /// this as a degraded full read rather than a 400 so a stale
    /// client doesn't get bricked.
    pub since: Option<String>,
}

/// `GET /api/agents/:agent_id/sessions/:session_id/events`
///
/// Per-session events read for the standalone-agent surfaces. Sister
/// of the project-scoped
/// `/api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id/events`
/// — same response shape (`Vec<SessionEvent>`) so the client-side
/// `apiFetch` deserializer is reused — but keyed on the template
/// `agent_id` so `useStandaloneAgentChat` can hydrate a chat panel
/// scoped to a single `?session=` pin without falling back to the
/// per-agent timeline (which aggregates across every session and
/// dragged old-session messages back into the panel after the user
/// pressed `+`).
///
/// The handler enforces ownership: the session's `project_agent_id`
/// must resolve to a project-agent whose template `agent_id` matches
/// the URL parameter. Any mismatch returns 404 (we don't differentiate
/// "session belongs to another agent" from "session does not exist"
/// because both leak nothing useful to a caller probing for ids).
pub(crate) async fn list_agent_session_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((agent_id, session_id)): Path<(AgentId, SessionId)>,
    Query(query): Query<AgentSessionEventsQuery>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let storage = state.require_storage_client()?;
    let session_id_str = session_id.to_string();
    let agent_id_str = agent_id.to_string();

    let storage_session =
        storage
            .get_session(&session_id_str, &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("session not found")
                }
                _ => map_storage_error(e),
            })?;

    let project_agent_id = storage_session
        .project_agent_id
        .clone()
        .ok_or_else(|| ApiError::not_found("session not found"))?;

    let project_agent = storage
        .get_project_agent(&project_agent_id, &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;

    let owns_session = project_agent.agent_id.as_deref() == Some(agent_id_str.as_str());
    if !owns_session {
        warn!(
            %agent_id,
            %session_id,
            owner_agent_id = ?project_agent.agent_id,
            "list_agent_session_events: session does not belong to URL agent",
        );
        return Err(ApiError::not_found("session not found"));
    }

    let project_id = storage_session.project_id.clone().unwrap_or_default();
    let storage_events = storage
        .list_events(&session_id_str, &jwt, None, None)
        .await
        .map_err(map_storage_error)?;
    let mut messages = events_to_session_history(&storage_events, &project_agent_id, &project_id);

    if let Some(since) = query.since.as_deref() {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(since) {
            let cutoff = parsed.with_timezone(&chrono::Utc);
            messages.retain(|m| m.created_at > cutoff);
        } else {
            warn!(
                %session_id,
                since,
                "list_agent_session_events: ignoring malformed `since` query (not RFC 3339)"
            );
        }
    }

    if let Some(limit) = normalize_agent_history_limit(query.limit) {
        if limit == 0 {
            messages.clear();
        } else if messages.len() > limit {
            let start = messages.len() - limit;
            messages = messages.split_off(start);
        }
    }

    Ok(Json(messages))
}
