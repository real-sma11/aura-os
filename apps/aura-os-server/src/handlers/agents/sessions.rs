use axum::extract::{Path, State};
use axum::Json;
use futures_util::future::join_all;
use serde::Serialize;
use serde_json::json;
use tracing::{info, warn};

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, Session, SessionEvent, SessionId, Task};
use aura_os_sessions::storage_session_to_session;
use aura_os_storage::StorageClient;
use aura_protocol::ContextBreakdown;

use crate::capture_auth::{demo_agent_id, demo_agent_instance_id, is_capture_access_token};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::chat::{find_matching_project_agents, storage_session_sort_key};
use super::conversions::events_to_session_history;

const HAIKU_MODEL: &str = "claude-haiku-4-5-20251001";
/// 32 tokens is plenty for a 2-5 word title; the extra slack is room
/// for Haiku to choose the slightly-longer phrasing when the topic
/// genuinely needs it (e.g. "Cyberpunk Character Design Iteration").
const SUMMARY_MAX_TOKENS: u32 = 32;
const TRANSCRIPT_CHAR_LIMIT: usize = 4000;
/// Cap how much of the user's first message we send to the title
/// model. 2k chars covers any reasonable prompt and keeps the request
/// small; longer prompts get truncated rather than blowing past
/// router limits.
const TITLE_INPUT_CHAR_LIMIT: usize = 2000;

/// Title-style system prompt shared by `generate_session_title` (the
/// new on-send WebSocket-pushed flow) and `generate_session_summary`
/// (the legacy lazy /summarize endpoint, kept for backfilling sessions
/// that were created before the on-send path existed).
///
/// Calibrated to mimic ChatGPT's recents list — short, scannable,
/// title-cased noun phrases like "Heartburn During Water Fast" or
/// "Logo Addition Request". Plain text only because the sidekick row
/// renders the result as a single-line label and any `#`/`**`/`-`
/// decoration leaks through as literal characters; the render-time
/// strip in `interface/src/components/SessionsList/session-row-utils.ts`
/// is a backstop for older summaries that already carry these
/// prefixes.
const TITLE_SYSTEM_PROMPT: &str = "Generate a concise 2-5 word title for this conversation \
based on the user's message. Use title case (e.g. \"Heartburn During Water Fast\", \
\"Logo Addition Request\", \"Cyberpunk Character Design\"). Be specific to the topic. \
No quotes, no trailing punctuation. Output only the title, nothing else.";

/// Strip whitespace, surrounding quotes, and trailing punctuation that
/// the model occasionally appends despite the prompt asking it not to.
/// Returns an empty string if nothing meaningful remains.
fn clean_title(raw: &str) -> String {
    let trimmed = raw.trim();
    let stripped = trimmed
        .trim_start_matches(|c| c == '"' || c == '\'' || c == '`')
        .trim_end_matches(|c| c == '"' || c == '\'' || c == '`' || c == '.' || c == ':');
    stripped.trim().to_string()
}

pub(crate) async fn list_project_sessions(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Session>>> {
    let storage = state.require_storage_client()?;

    let storage_agents = storage
        .list_project_agents(&project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let mut sessions = Vec::new();
    for agent in &storage_agents {
        match storage.list_sessions(&agent.id, &jwt).await {
            Ok(agent_sessions) => {
                for ss in agent_sessions {
                    match storage_session_to_session(ss, None) {
                        Ok(s) => sessions.push(s),
                        Err(e) => warn!(error = %e, "skipping malformed session"),
                    }
                }
            }
            Err(e) => warn!(agent_id = %agent.id, error = %e, "failed to list sessions for agent"),
        }
    }
    sessions = filter_nonempty_sessions(storage, &jwt, sessions).await;
    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(Json(sessions))
}

pub(crate) async fn list_sessions(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Session>>> {
    let storage = state.require_storage_client()?;
    let storage_sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;
    let sessions: Vec<Session> = storage_sessions
        .into_iter()
        .filter_map(|s| {
            storage_session_to_session(s, None)
                .map_err(|e| warn!(error = %e, "skipping malformed session"))
                .ok()
        })
        .collect();
    let sessions = filter_nonempty_sessions(storage, &jwt, sessions).await;
    Ok(Json(sessions))
}

/// Drop sessions that have zero persisted events.
///
/// Sessions get created in storage *before* the first user message is
/// persisted (see `create_new_chat_session` in
/// `apps/aura-os-server/src/handlers/agents/chat/persist.rs`), so any
/// race or persist failure on the very first turn leaves an orphan
/// session row with no events. Plus there's pre-`lazy-+` legacy data
/// already in storage from before the chat-input "+" became lazy.
///
/// The frontend `SessionsList` renders these orphans as "New chat"
/// rows that do nothing on click — clicking flips `?session=<id>` to
/// a transcript with no events, looking visually identical to where
/// the user already was. Filtering at the API is the simplest way to
/// keep the sidekick honest without a schema change.
///
/// The probe is one `list_events?limit=1` per session, fanned out via
/// `join_all`. Probe errors fail-open (we keep the session) so a
/// transient aura-storage hiccup never makes a real chat disappear.
async fn filter_nonempty_sessions(
    storage: &StorageClient,
    jwt: &str,
    sessions: Vec<Session>,
) -> Vec<Session> {
    if sessions.is_empty() {
        return sessions;
    }
    let probes = sessions.iter().map(|s| {
        let sid = s.session_id.to_string();
        async move {
            match storage.list_events(&sid, jwt, Some(1), None).await {
                Ok(events) => !events.is_empty(),
                Err(e) => {
                    warn!(
                        session_id = %sid,
                        error = %e,
                        "list_events probe failed while filtering empty sessions; keeping row",
                    );
                    true
                }
            }
        }
    });
    let keep = join_all(probes).await;
    sessions
        .into_iter()
        .zip(keep)
        .filter_map(|(s, k)| if k { Some(s) } else { None })
        .collect()
}

pub(crate) async fn get_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Session>> {
    let storage = state.require_storage_client()?;
    let ss = storage
        .get_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;
    let session = storage_session_to_session(ss, None).map_err(ApiError::internal)?;
    Ok(Json(session))
}

pub(crate) async fn delete_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<axum::http::StatusCode> {
    let storage = state.require_storage_client()?;

    storage
        .delete_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            // Anything else from aura-storage (auth, FK conflict, 5xx,
            // transport, validation) used to be collapsed into a flat
            // `ApiError::internal` with no server-side log, which made
            // right-click "Delete session" appear silently broken — the
            // tower-http `on_failure` line only carried the 500 and the
            // optimistic UI rolled back without surfacing a reason.
            // Log the upstream status + a body preview here and reuse
            // the same `map_storage_error` mapping the sibling handlers
            // (`get_session`, `list_session_tasks`, …) already use so
            // the response carries the real upstream status (e.g. 409
            // / 502) and the FE toast can show the actual reason.
            aura_os_storage::StorageError::Server { status, body } => {
                let preview: String = body.chars().take(300).collect();
                warn!(
                    %session_id,
                    upstream_status = status,
                    body_preview = %preview,
                    "delete_session: aura-storage rejected DELETE",
                );
                map_storage_error(e)
            }
            _ => {
                warn!(%session_id, error = %e, "delete_session: storage call failed");
                map_storage_error(e)
            }
        })?;

    info!(%session_id, "Session deleted");

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub(crate) async fn list_session_tasks(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;

    storage
        .get_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;

    let storage_tasks = storage
        .list_tasks(&_project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter(|t| t.session_id.as_deref() == Some(&session_id.to_string()))
        .filter_map(|s| crate::handlers::tasks::storage_task_to_task(s).ok())
        .collect();

    Ok(Json(tasks))
}

pub(crate) async fn list_session_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let storage = state.require_storage_client()?;

    let events = storage
        .list_events(&session_id.to_string(), &jwt, None, None)
        .await
        .map_err(map_storage_error)?;

    let messages = events_to_session_history(
        &events,
        &_agent_instance_id.to_string(),
        &_project_id.to_string(),
    );
    Ok(Json(messages))
}

pub(crate) async fn generate_session_summary(
    storage: &StorageClient,
    http: &reqwest::Client,
    router_url: &str,
    jwt: &str,
    session_id: &str,
    project_id: &str,
    agent_id: &str,
) -> Result<String, String> {
    let events = storage
        .list_events(session_id, jwt, None, None)
        .await
        .map_err(|e| format!("listing events: {e}"))?;

    let mut transcript = String::new();
    for event in &events {
        let event_type = event.event_type.as_deref().unwrap_or("");
        let content = event.content.as_ref();
        let text = content
            .and_then(|c| c.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let role = match event_type {
            "user_message" => "User",
            "assistant_message_end" | "task_output" => "Assistant",
            _ => continue,
        };
        transcript.push_str(role);
        transcript.push_str(": ");
        transcript.push_str(text);
        transcript.push('\n');
        if transcript.len() > TRANSCRIPT_CHAR_LIMIT {
            transcript.truncate(TRANSCRIPT_CHAR_LIMIT);
            transcript.push_str("\n[truncated]");
            break;
        }
    }

    if transcript.is_empty() {
        return Ok(String::new());
    }

    // Lazy /summarize endpoint also produces ChatGPT-style titles now,
    // so old sessions backfilled by `useSessionSummaries` end up with
    // the same look as new sessions titled on-send by
    // `generate_session_title`. The transcript loaded above gives Haiku
    // a few extra turns of context to title against (vs. titling from
    // just the first user message), which is useful when the first
    // message alone is ambiguous like "fix this" or "again".
    let req_body = json!({
        "model": HAIKU_MODEL,
        "max_tokens": SUMMARY_MAX_TOKENS,
        "system": [
            {
                "type": "text",
                "text": TITLE_SYSTEM_PROMPT,
                "cache_control": { "type": "ephemeral" }
            }
        ],
        "messages": [{"role": "user", "content": transcript}],
    });

    // Stamp the aura-* attribution headers so this LLM round-trip's
    // tokens and cost land on the right session/project. Without these,
    // aura-router's SessionContext::from_headers returns None and the
    // resulting token_usage_daily row gets project_id=null — silently
    // excluded from per-project cost aggregation.
    let resp = http
        .post(format!("{router_url}/v1/messages"))
        .bearer_auth(jwt)
        .header("anthropic-beta", "prompt-caching-2024-07-31")
        .header("x-aura-session-id", session_id)
        .header("x-aura-project-id", project_id)
        .header("x-aura-agent-id", agent_id)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("LLM returned {status}: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parsing LLM response: {e}"))?;

    let summary = clean_title(
        body.get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|block| block.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or(""),
    );

    if !summary.is_empty() {
        let update_req = aura_os_storage::UpdateSessionRequest {
            status: None,
            total_input_tokens: None,
            total_output_tokens: None,
            context_usage_estimate: None,
            summary_of_previous_context: Some(summary.clone()),
            tasks_worked_count: None,
            ended_at: None,
        };
        storage
            .update_session(session_id, jwt, &update_req)
            .await
            .map_err(|e| format!("updating session summary: {e}"))?;
    }

    Ok(summary)
}

/// On-send title generator. Builds a ChatGPT-style 2-5 word noun
/// phrase from the user's first message in a brand-new session and
/// persists it as `summary_of_previous_context`. Designed to be
/// `tokio::spawn`'d from the chat send path so the title lands in the
/// sidekick before the assistant's turn finishes streaming.
///
/// Distinct from `generate_session_summary` (lazy /summarize endpoint)
/// because we already have the user's message in hand and don't need
/// to round-trip storage to load the transcript — keeping the
/// critical-path latency low. The router call shape (Haiku, x-aura-*
/// attribution headers, /v1/messages) mirrors that function so token
/// usage lands on the right session and project.
pub(crate) async fn generate_session_title(
    storage: &StorageClient,
    http: &reqwest::Client,
    router_url: &str,
    jwt: &str,
    session_id: &str,
    project_id: &str,
    agent_id: &str,
    first_user_message: &str,
) -> Result<String, String> {
    let trimmed = first_user_message.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let prompt_input: &str = if trimmed.len() > TITLE_INPUT_CHAR_LIMIT {
        &trimmed[..TITLE_INPUT_CHAR_LIMIT]
    } else {
        trimmed
    };

    let req_body = json!({
        "model": HAIKU_MODEL,
        "max_tokens": SUMMARY_MAX_TOKENS,
        "system": [
            {
                "type": "text",
                "text": TITLE_SYSTEM_PROMPT,
                "cache_control": { "type": "ephemeral" }
            }
        ],
        "messages": [{"role": "user", "content": prompt_input}],
    });

    let resp = http
        .post(format!("{router_url}/v1/messages"))
        .bearer_auth(jwt)
        .header("anthropic-beta", "prompt-caching-2024-07-31")
        .header("x-aura-session-id", session_id)
        .header("x-aura-project-id", project_id)
        .header("x-aura-agent-id", agent_id)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("title LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("title LLM returned {status}: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parsing title LLM response: {e}"))?;

    let title = clean_title(
        body.get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|block| block.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or(""),
    );

    if title.is_empty() {
        return Ok(String::new());
    }

    let update_req = aura_os_storage::UpdateSessionRequest {
        status: None,
        total_input_tokens: None,
        total_output_tokens: None,
        context_usage_estimate: None,
        summary_of_previous_context: Some(title.clone()),
        tasks_worked_count: None,
        ended_at: None,
    };
    storage
        .update_session(session_id, jwt, &update_req)
        .await
        .map_err(|e| format!("updating session title: {e}"))?;

    Ok(title)
}

pub(crate) async fn summarize_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Session>> {
    let storage = state.require_storage_client()?;

    let sid = session_id.to_string();
    let pid = project_id.to_string();
    let aid = agent_instance_id.to_string();
    info!(%session_id, "Session summary generation requested");

    let summary = generate_session_summary(
        storage,
        &state.http_client,
        &state.router_url,
        &jwt,
        &sid,
        &pid,
        &aid,
    )
    .await
    .map_err(|e| ApiError::internal(format!("summarizing session: {e}")))?;

    info!(%session_id, summary_len = summary.len(), "Session summary generated");

    let ss = storage
        .get_session(&sid, &jwt)
        .await
        .map_err(map_storage_error)?;
    let session = storage_session_to_session(ss, None).map_err(ApiError::internal)?;
    Ok(Json(session))
}

#[derive(Serialize)]
pub(crate) struct ContextUsageResponse {
    pub context_utilization: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_context_tokens: Option<u64>,
    /// Per-bucket token estimates from the most recent persisted
    /// `assistant_message_end` event for the session. Absent on older
    /// harness builds (where the field was either missing or all-zero);
    /// the frontend treats an absent breakdown as "not available" and
    /// falls back to the legacy two-row Used/Total card.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_breakdown: Option<ContextBreakdown>,
}

/// Usage snapshot derived from the most recent persisted
/// `assistant_message_end` event for a session.
#[derive(Clone, Default)]
struct SessionContextUsage {
    utilization: f32,
    estimated_context_tokens: Option<u64>,
    context_breakdown: Option<ContextBreakdown>,
}

/// Representative breakdown returned by the demo capture-token branches
/// of the context-usage endpoints. The buckets are sized to roughly
/// match the demo's `estimated_context_tokens = 33_280` so the marketing
/// surface can exercise the new stacked-bar popover end-to-end.
fn demo_context_breakdown() -> ContextBreakdown {
    ContextBreakdown {
        system_prompt_tokens: 4_200,
        tools_tokens: 6_800,
        skills_tokens: 1_500,
        mcp_tokens: 0,
        subagents_tokens: 980,
        conversation_tokens: 19_800,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
    }
}

/// Pull the most recent context usage out of a storage session.
///
/// Chat sessions do NOT update `Session.context_usage_estimate` today —
/// only the dev-loop writes that column. So for chat the authoritative
/// source is the `usage.context_utilization` field embedded in the most
/// recent `assistant_message_end` event for the session (see
/// `chat.rs` ~line 528 where the end payload is persisted).
///
/// Walks the session's events newest-first (by looking at the persisted
/// `seq`/timestamp order returned by storage) and returns the first
/// `assistant_message_end` whose payload has a usable
/// `usage.context_utilization`; when present, also pulls
/// `usage.estimated_context_tokens` from the same payload so the UI can
/// display absolute used/total numbers alongside the percentage. Falls
/// back to `session.context_usage_estimate` (dev-loop's source) when no
/// such event exists.
async fn latest_context_usage_for_session(
    storage: &StorageClient,
    jwt: &str,
    session: &aura_os_storage::StorageSession,
) -> Option<SessionContextUsage> {
    let events = match storage.list_events(&session.id, jwt, None, None).await {
        Ok(e) => e,
        Err(e) => {
            warn!(session_id = %session.id, error = %e, "context-usage: list_events failed");
            return session.context_usage_estimate.map(|v| SessionContextUsage {
                utilization: v as f32,
                estimated_context_tokens: None,
                context_breakdown: None,
            });
        }
    };

    let found = events
        .iter()
        .rev()
        .filter(|evt| evt.event_type.as_deref() == Some("assistant_message_end"))
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
            // Older harness builds may omit `context_breakdown` entirely
            // or emit `ContextBreakdown::default()` (all zeros). In both
            // cases we want the response to *not* carry the field so
            // the frontend stays on its legacy popover branch via the
            // existing `breakdown == null` check. Parse failures are
            // treated the same as missing.
            let context_breakdown = usage
                .get("context_breakdown")
                .and_then(|cb| serde_json::from_value::<ContextBreakdown>(cb.clone()).ok())
                .filter(|cb| !cb.is_empty());
            Some(SessionContextUsage {
                utilization: raw as f32,
                estimated_context_tokens,
                context_breakdown,
            })
        });

    found.or_else(|| {
        session.context_usage_estimate.map(|v| SessionContextUsage {
            utilization: v as f32,
            estimated_context_tokens: None,
            context_breakdown: None,
        })
    })
}

/// GET `/api/agents/:agent_id/context-usage` — returns the latest
/// observed `context_utilization` across every session owned by every
/// project_agent that shares this template agent id. Used by the UI to
/// seed the bottom-left context indicator on chat mount without waiting
/// for the first assistant turn.
///
/// Returns 0.0 when storage is unavailable, when there are no matching
/// project_agents, or when none of them have any sessions with recorded
/// usage yet.
pub(crate) async fn get_agent_context_usage(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<ContextUsageResponse>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        return Ok(Json(ContextUsageResponse {
            context_utilization: 0.34,
            estimated_context_tokens: Some(33_280),
            context_breakdown: Some(demo_context_breakdown()),
        }));
    }

    let storage = state.require_storage_client()?;
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(&state, storage, &jwt, &agent_id_str).await;
    if matching.is_empty() {
        return Ok(Json(ContextUsageResponse {
            context_utilization: 0.0,
            estimated_context_tokens: None,
            context_breakdown: None,
        }));
    }

    let mut latest: Option<aura_os_storage::StorageSession> = None;
    for pa in &matching {
        let sessions = match storage.list_sessions(&pa.id, &jwt).await {
            Ok(sessions) => sessions,
            Err(e) => {
                warn!(project_agent_id = %pa.id, error = %e, "context-usage: list_sessions failed; skipping");
                continue;
            }
        };
        if let Some(candidate) = sessions.into_iter().max_by_key(storage_session_sort_key) {
            latest = match latest {
                Some(existing)
                    if storage_session_sort_key(&existing)
                        >= storage_session_sort_key(&candidate) =>
                {
                    Some(existing)
                }
                _ => Some(candidate),
            };
        }
    }

    let usage = match latest {
        Some(session) => latest_context_usage_for_session(storage, &jwt, &session)
            .await
            .unwrap_or_default(),
        None => SessionContextUsage::default(),
    };
    Ok(Json(ContextUsageResponse {
        context_utilization: usage.utilization,
        estimated_context_tokens: usage.estimated_context_tokens,
        context_breakdown: usage.context_breakdown,
    }))
}

/// GET `/api/projects/:project_id/agents/:agent_instance_id/context-usage` —
/// project-scoped analogue: returns the latest observed
/// `context_utilization` for a single agent instance.
pub(crate) async fn get_instance_context_usage(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<ContextUsageResponse>> {
    if is_capture_access_token(&jwt) && agent_instance_id == demo_agent_instance_id() {
        return Ok(Json(ContextUsageResponse {
            context_utilization: 0.34,
            estimated_context_tokens: Some(33_280),
            context_breakdown: Some(demo_context_breakdown()),
        }));
    }

    let storage = state.require_storage_client()?;
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let latest = sessions.into_iter().max_by_key(storage_session_sort_key);

    let usage = match latest {
        Some(session) => latest_context_usage_for_session(storage, &jwt, &session)
            .await
            .unwrap_or_default(),
        None => SessionContextUsage::default(),
    };

    Ok(Json(ContextUsageResponse {
        context_utilization: usage.utilization,
        estimated_context_tokens: usage.estimated_context_tokens,
        context_breakdown: usage.context_breakdown,
    }))
}
