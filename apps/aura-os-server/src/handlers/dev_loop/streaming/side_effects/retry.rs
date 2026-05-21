//! Task-level retry plumbing for the dev-loop forwarder.
//!
//! Phase 4 of the dev-loop simplification (see
//! `~/.cursor/plans/simplify_dev-loop_harness_d6af7a5d.plan.md`)
//! collapsed the parallel server-side retry state machine into a
//! single decision:
//!
//! ```text
//! on task_failed:
//!     kind = HarnessFailureKind from event.reason
//!     if kind.is_retryable() && task.attempts < MAX_TASK_ATTEMPTS:
//!         storage.update_task(attempts = task.attempts + 1)
//!         safe_transition(Failed -> Ready)
//!         emit task_retrying
//!     else:
//!         leave task in Failed
//! ```
//!
//! The persisted `tasks.attempts` counter (added in the same phase,
//! see `docs/migrations/2026-05-21-task-attempts-column.md`) replaces
//! the previous in-memory task-retry tracker. Tool-level retries are
//! now the harness's responsibility — it sees every tool result; the
//! server does not need a parallel tool-retry tracker.

use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskStatus};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_harness::signals::{HarnessFailureKind, HarnessSignal};

use super::failure::resolve_failure_reason_for_persistence;
use super::MAX_TASK_ATTEMPTS;
use crate::state::AppState;

/// Parse a failure reason string into a typed
/// [`HarnessFailureKind`], using the canonical
/// `aura-os-harness::signals::classify_failure` router so the
/// server-side retry decision can never drift from the harness's
/// own classifier ordering.
fn classify_reason(reason: &str) -> HarnessFailureKind {
    HarnessSignal::from_event("task_failed", &serde_json::json!({ "reason": reason }))
        .and_then(|signal| signal.failure_kind())
        .unwrap_or(HarnessFailureKind::Other)
}

/// Decide whether to push the failed task back to `Ready` and emit
/// the `task_retrying` UI signal. Gated by:
///
/// * [`HarnessFailureKind::is_retryable`] — terminal failures
///   (agent-stuck, insufficient credits) stay in `Failed`.
/// * The persisted `tasks.attempts` counter being strictly below
///   [`MAX_TASK_ATTEMPTS`] — a permanently-broken task does not
///   loop forever, and the count survives server restarts.
///
/// On a successful retry hop we bump `attempts` and transition the
/// task back to `Ready` in a single `update_task` call before the
/// `safe_transition` so the next attempt observes the incremented
/// counter even if the transition itself races with another reader.
#[allow(clippy::too_many_arguments)]
pub(super) async fn maybe_apply_task_level_retry(
    state: &AppState,
    jwt: &str,
    task_id: &str,
    event: &serde_json::Value,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    let reason = resolve_failure_reason_for_persistence(event);
    let kind = classify_reason(&reason);
    if !kind.is_retryable() {
        return;
    }
    // Read the persisted attempt count. If the storage call fails
    // we conservatively leave the task in `Failed` rather than
    // double-spending the budget on a count we can't verify.
    let task = match storage.get_task(task_id, jwt).await {
        Ok(storage_task) => storage_task,
        Err(error) => {
            warn!(
                %task_id,
                %error,
                "task-level retry: get_task failed; leaving task in Failed"
            );
            return;
        }
    };
    let prior_attempts = task.attempts.unwrap_or(0);
    if prior_attempts >= MAX_TASK_ATTEMPTS {
        info!(
            %task_id,
            prior_attempts,
            budget = MAX_TASK_ATTEMPTS,
            "task-level retry: attempt budget exhausted; leaving task in Failed"
        );
        return;
    }
    let next_attempts = prior_attempts.saturating_add(1);
    let update = aura_os_storage::UpdateTaskRequest {
        attempts: Some(next_attempts),
        ..Default::default()
    };
    if let Err(error) = storage.update_task(task_id, jwt, &update).await {
        warn!(
            %task_id,
            %error,
            "task-level retry: update_task(attempts) failed; leaving task in Failed"
        );
        return;
    }
    if let Err(error) =
        aura_os_tasks::safe_transition(storage, jwt, task_id, TaskStatus::Ready).await
    {
        warn!(
            %task_id,
            %error,
            "task-level retry: safe_transition(Failed -> Ready) failed after bumping attempts; \
             leaving task in Failed"
        );
        return;
    }
    info!(
        %task_id,
        attempt = next_attempts,
        budget = MAX_TASK_ATTEMPTS,
        ?kind,
        "task-level retry: pushed task from Failed back to Ready"
    );
    emit_task_retrying_signal(
        state,
        project_id,
        agent_instance_id,
        task_id,
        next_attempts,
        MAX_TASK_ATTEMPTS,
        &reason,
        session_id,
    );
}

/// Emit a `task_retrying` event onto both the legacy
/// `event_broadcast` firehose and the topic-scoped event hub so
/// live subscribers (`useTaskStatus`, dev-loop UI) can render the
/// retry banner without polling. Mirrors the JSON shape of
/// `task_failed` / `task_completed` so existing front-end handlers
/// can decode the same fields.
#[allow(clippy::too_many_arguments)]
fn emit_task_retrying_signal(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    attempt: u32,
    budget: u32,
    reason: &str,
    session_id: Option<SessionId>,
) {
    let mut payload = serde_json::json!({
        "type": "task_retrying",
        "task_id": task_id,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
        "attempt": attempt,
        "budget": budget,
        "scope": "task_level",
        "reason": reason,
    });
    if let Some(session_id) = session_id {
        if let Some(object) = payload.as_object_mut() {
            object.insert("session_id".to_string(), session_id.to_string().into());
        }
    }
    let _ = state.event_broadcast.send(payload.clone());
    state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            session_id,
            loop_id: None,
            payload,
        }));
}
