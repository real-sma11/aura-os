//! Chat persistence context and the lowest-level write paths used by the
//! chat handler: session resolution, retiring stale sessions, and writing
//! the inbound user message.

use std::sync::Arc;

use aura_os_storage::StorageClient;
use chrono::Utc;
use tracing::{error, warn};

use crate::dto::ChatAttachmentDto;

use super::discovery::storage_session_sort_key;

#[derive(Clone)]
pub(crate) struct ChatPersistCtx {
    pub(crate) storage: Arc<StorageClient>,
    pub(crate) jwt: String,
    pub(crate) session_id: String,
    pub(crate) project_agent_id: String,
    pub(crate) project_id: String,
    /// Org-level agent id (the `agents.agent_id` from aura-network)
    /// this persistence context belongs to. Distinct from
    /// `project_agent_id` (the project binding). We broadcast it in
    /// `user_message` / `assistant_message_end` so the UI can key
    /// standalone-chat history entries by the same id the sidebar
    /// uses (`agentHistoryKey(agent_id)`); without it cross-agent
    /// `send_to_agent` deliveries only refresh the sender's view and
    /// the recipient's chat window stays stale until the user hits F5.
    pub(crate) agent_id: Option<String>,
}

/// Outcome of attempting to validate a caller-supplied
/// `pinned_session_id` against the agent's session list. The mismatch
/// arm carries enough detail for the handler to return a structured
/// 400 instead of a generic 500.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PinnedSessionOutcome {
    /// No pin requested — fall through to the legacy resolution path.
    NotRequested,
    /// Pin matched a session that belongs to this agent — use as-is.
    Matched(String),
    /// Pin pointed at a session that does not belong to this agent.
    Mismatch { session_id: String },
}

/// Validate that `pinned_session_id` belongs to the project agent
/// before we wire it into persistence. Returning a structured result
/// (vs. silently falling back to the latest session) lets callers
/// surface a 400 to the UI and avoids scribbling messages from one
/// session into another.
pub(crate) async fn try_pin_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    pinned_session_id: Option<&str>,
) -> PinnedSessionOutcome {
    let Some(pinned) = pinned_session_id else {
        return PinnedSessionOutcome::NotRequested;
    };
    let pinned = pinned.to_string();
    match storage.list_sessions(project_agent_id, jwt).await {
        Ok(sessions) => {
            if sessions.iter().any(|s| s.id == pinned) {
                PinnedSessionOutcome::Matched(pinned)
            } else {
                PinnedSessionOutcome::Mismatch {
                    session_id: pinned,
                }
            }
        }
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions while validating pinned session_id; treating as mismatch"
            );
            PinnedSessionOutcome::Mismatch {
                session_id: pinned,
            }
        }
    }
}

pub(crate) async fn resolve_chat_session_with_pin(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
    force_new: bool,
    pinned_session_id: Option<&str>,
) -> Option<String> {
    // `force_new` wins over `pinned_session_id`: callers that
    // explicitly want a brand-new session (the chat-input "+" button)
    // shouldn't accidentally land in an old session because their
    // URL still has `?session=...`.
    if !force_new {
        if let Some(pinned) = pinned_session_id {
            // Trust the pin if it survived `try_pin_session` upstream;
            // re-validating here would double the round-trip on
            // every turn. Callers (the chat handlers) validate up
            // front and 400 on mismatch before reaching here.
            return Some(pinned.to_string());
        }
        if let Some(existing) = existing_session_for_agent(storage, jwt, project_agent_id).await {
            return Some(existing);
        }
    }
    close_active_sessions_for_agent(storage, jwt, project_agent_id).await;
    create_new_chat_session(storage, jwt, project_agent_id, project_id).await
}

async fn existing_session_for_agent(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
) -> Option<String> {
    match storage.list_sessions(project_agent_id, jwt).await {
        Ok(sessions) => {
            // Sort by the same recency key the reader uses so a writer
            // never lands in a different session than
            // `load_project_session_history` will later read from.
            // Storage may return sessions in any order (insertion,
            // alphanumeric id, etc.); we want newest-by-timestamp first.
            //
            // Previously we also walked the sorted list and issued a
            // `list_events(limit=1)` probe on each candidate to skip
            // "stale" sessions. That added one round-trip per session
            // on the hot path — for users with long chat histories
            // this was the single slowest setup step. Trust the sort
            // key instead: if the newest session by timestamp is
            // structurally unreadable the very next persist will
            // surface the error, and the UI loader applies the same
            // sort key so writer/reader can't diverge.
            sessions
                .iter()
                .max_by_key(|s| storage_session_sort_key(s))
                .map(|s| s.id.clone())
        }
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions for chat resolution"
            );
            None
        }
    }
}

async fn create_new_chat_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
) -> Option<String> {
    let req = aura_os_storage::CreateSessionRequest {
        project_id: project_id.to_string(),
        org_id: None,
        model: None,
        status: Some("active".to_string()),
        context_usage_estimate: None,
        summary_of_previous_context: None,
    };
    match storage.create_session(project_agent_id, jwt, &req).await {
        Ok(session) => Some(session.id),
        Err(e) => {
            error!(error = %e, %project_agent_id, "Failed to create chat session in storage");
            None
        }
    }
}

/// Flip any lingering `active` sessions for this agent instance to
/// `completed` so the sidekick does not render historical sessions as
/// spinning/in-progress. Failures are logged and swallowed: retiring old
/// sessions is best-effort and must never block creation of a new one.
pub(super) async fn close_active_sessions_for_agent(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
) {
    let sessions = match storage.list_sessions(project_agent_id, jwt).await {
        Ok(list) => list,
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions while retiring stale active sessions"
            );
            return;
        }
    };

    let now = Utc::now().to_rfc3339();
    for session in sessions {
        if session.status.as_deref() != Some("active") {
            continue;
        }
        let req = aura_os_storage::UpdateSessionRequest {
            status: Some("completed".to_string()),
            total_input_tokens: None,
            total_output_tokens: None,
            context_usage_estimate: None,
            summary_of_previous_context: None,
            tasks_worked_count: None,
            ended_at: Some(now.clone()),
        };
        if let Err(e) = storage.update_session(&session.id, jwt, &req).await {
            warn!(session_id = %session.id, error = %e, "Failed to retire stale active session");
        }
    }
}

/// Persist the inbound user message to storage and return the created
/// event on success.
///
/// Previously this fire-and-forget spawned a background task that only
/// logged failures, which let the CEO's `send_to_agent` tool report
/// `persisted: true` for writes that silently vanished from the target
/// agent's chat history. Callers are now required to `.await` this
/// function and hard-fail the request on `Err` — no silent success.
pub(crate) async fn persist_user_message(
    ctx: &ChatPersistCtx,
    content: &str,
    attachments: &Option<Vec<ChatAttachmentDto>>,
) -> Result<aura_os_storage::StorageSessionEvent, aura_os_storage::StorageError> {
    let payload = build_user_message_payload(content, attachments);
    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(ctx.session_id.clone()),
        user_id: None,
        agent_id: Some(ctx.project_agent_id.clone()),
        sender: Some("user".to_string()),
        project_id: Some(ctx.project_id.clone()),
        org_id: None,
        event_type: "user_message".to_string(),
        content: Some(payload),
    };
    match ctx
        .storage
        .create_event(&ctx.session_id, &ctx.jwt, &req)
        .await
    {
        Ok(evt) => Ok(evt),
        Err(e) => {
            log_user_message_persist_failure(ctx, &e);
            Err(e)
        }
    }
}

fn build_user_message_payload(
    content: &str,
    attachments: &Option<Vec<ChatAttachmentDto>>,
) -> serde_json::Value {
    let content_blocks: Option<serde_json::Value> = attachments.as_ref().and_then(|atts| {
        let image_blocks: Vec<serde_json::Value> = atts
            .iter()
            .filter(|a| a.type_ == "image")
            .map(|a| {
                let mut block = serde_json::json!({
                    "type": "image",
                    "media_type": a.media_type,
                    "data": a.data,
                });
                if let Some(ref url) = a.source_url {
                    block["source_url"] = serde_json::Value::String(url.clone());
                }
                block
            })
            .collect();
        if image_blocks.is_empty() {
            None
        } else {
            let mut blocks = Vec::new();
            if !content.is_empty() {
                blocks.push(serde_json::json!({ "type": "text", "text": content }));
            }
            blocks.extend(image_blocks);
            Some(serde_json::Value::Array(blocks))
        }
    });

    let mut payload = serde_json::json!({ "text": content });
    if let Some(blocks) = content_blocks {
        payload["content_blocks"] = blocks;
    }
    payload
}

fn log_user_message_persist_failure(ctx: &ChatPersistCtx, err: &aura_os_storage::StorageError) {
    let (upstream_status, body_preview) = match err {
        aura_os_storage::StorageError::Server { status, body } => {
            (Some(*status), body.chars().take(400).collect::<String>())
        }
        _ => (None, String::new()),
    };
    error!(
        error = %err,
        upstream_status = ?upstream_status,
        body_preview = %body_preview,
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        project_id = %ctx.project_id,
        "Failed to persist user message event"
    );
}

#[cfg(test)]
mod pin_tests {
    //! Pin down the contract for `try_pin_session` and
    //! `resolve_chat_session_with_pin`. Both functions guard the chat
    //! handler against routing a turn into the wrong session when the
    //! UI's `?session=` query param disagrees with storage. These
    //! tests use the in-memory mock storage so we don't need to pay
    //! the cost of a real backend.

    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::{CreateSessionRequest, StorageClient};

    use super::{
        resolve_chat_session_with_pin, try_pin_session, PinnedSessionOutcome,
    };

    /// Helper: spin up the mock storage and create one session for
    /// `agent_id` so the tests have a real session id to pin.
    async fn fixture(agent_id: &str) -> (StorageClient, String) {
        let (url, _db) = start_mock_storage().await;
        let storage = StorageClient::with_base_url(&url);
        let session = storage
            .create_session(
                agent_id,
                "jwt",
                &CreateSessionRequest {
                    project_id: "project-x".to_string(),
                    org_id: None,
                    model: None,
                    status: Some("active".to_string()),
                    context_usage_estimate: None,
                    summary_of_previous_context: None,
                },
            )
            .await
            .expect("mock storage create_session");
        // Leak the temp DB so it lives for the whole test — the
        // returned client only needs the URL to keep talking to it.
        // The mock handle going out of scope here is fine because the
        // server task holds the DB alive for the test process.
        std::mem::forget(_db);
        (storage, session.id)
    }

    #[tokio::test]
    async fn try_pin_session_returns_not_requested_when_input_is_none() {
        let (storage, _sid) = fixture("agent-a").await;
        let outcome = try_pin_session(&storage, "jwt", "agent-a", None).await;
        assert_eq!(outcome, PinnedSessionOutcome::NotRequested);
    }

    #[tokio::test]
    async fn try_pin_session_matches_when_session_belongs_to_agent() {
        let (storage, sid) = fixture("agent-b").await;
        let outcome = try_pin_session(&storage, "jwt", "agent-b", Some(&sid)).await;
        assert_eq!(outcome, PinnedSessionOutcome::Matched(sid));
    }

    #[tokio::test]
    async fn try_pin_session_mismatches_when_session_id_is_unknown() {
        let (storage, _sid) = fixture("agent-c").await;
        let outcome =
            try_pin_session(&storage, "jwt", "agent-c", Some("session-from-another-agent")).await;
        assert_eq!(
            outcome,
            PinnedSessionOutcome::Mismatch {
                session_id: "session-from-another-agent".to_string()
            }
        );
    }

    #[tokio::test]
    async fn resolve_with_pin_uses_pinned_id_without_round_trip() {
        // When `pinned_session_id` is `Some`, the resolver trusts the
        // upstream `try_pin_session` validation and returns the pin
        // verbatim — even if the agent has other sessions.
        let (storage, _sid) = fixture("agent-d").await;
        let result = resolve_chat_session_with_pin(
            &storage,
            "jwt",
            "agent-d",
            "project-x",
            false,
            Some("pin-from-url"),
        )
        .await;
        assert_eq!(result.as_deref(), Some("pin-from-url"));
    }

    #[tokio::test]
    async fn resolve_force_new_overrides_pin() {
        // `force_new=true` (the chat input "+" button) wins over the
        // URL pin: the resolver creates a fresh session even when a
        // pin is supplied. Otherwise the user would land in the old
        // session because their URL still has `?session=`.
        let (storage, sid) = fixture("agent-e").await;
        let result = resolve_chat_session_with_pin(
            &storage,
            "jwt",
            "agent-e",
            "project-x",
            true,
            Some(&sid),
        )
        .await;
        let new_sid = result.expect("resolver should create a new session");
        assert_ne!(
            new_sid, sid,
            "force_new must beat the pin and yield a different session id"
        );
    }
}
