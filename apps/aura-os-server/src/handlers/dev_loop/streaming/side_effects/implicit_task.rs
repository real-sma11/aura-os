//! Bind a dev-loop run to a backlog task when the harness emits work
//! events (`tool_call_started`, `text_delta`, …) carrying a UUID
//! `task_id` but never sends an explicit `task_started` frame.
//!
//! The external automaton on port 8080 commonly skips `task_started`
//! while still tagging every tool/text event with the claimed task id.
//! Without this shim the server-side `LoopActivity.current_task_id`
//! stays `None`, `/loop/status.active_tasks` is empty, and the
//! frontend never mounts a Run pane row or per-task stream handlers.

use std::str::FromStr;

use aura_os_core::TaskId;
use tracing::info;

use super::dispatch;
use super::SideEffectCtx;
use super::super::super::streaming::{emit_domain_event_with_session, DomainEventInputs};

/// Event kinds that imply an active task when they carry a UUID
/// `task_id`. Terminal lifecycle events are excluded — they clear
/// the pointer via their own dispatch arms.
const IMPLICIT_BIND_KINDS: &[&str] = &[
    "text_delta",
    "thinking_delta",
    "tool_use_start",
    "tool_call_started",
    "tool_call_snapshot",
    "tool_call_completed",
    "tool_result",
    "progress",
    "assistant_message_end",
    "token_usage",
    "usage",
    "session_usage",
];

/// When the harness begins streaming work for a UUID task without an
/// explicit `task_started`, run the same side-effects as a real start
/// and emit a synthetic `task_started` WS frame so the frontend can
/// mount the Run pane row before the first tool/text delta lands.
pub(super) async fn maybe_bind_implicit_task(
    ctx: &SideEffectCtx<'_>,
    event_type: &str,
    task_id: Option<&str>,
) {
    if matches!(event_type, "task_started" | "task_completed" | "task_failed") {
        return;
    }
    if !IMPLICIT_BIND_KINDS.contains(&event_type) {
        return;
    }
    let Some(task_id) = task_id else {
        return;
    };
    let Ok(task_uuid) = TaskId::from_str(task_id) else {
        return;
    };
    let already_bound = ctx
        .loop_handle
        .snapshot()
        .is_some_and(|activity| activity.current_task_id == Some(task_uuid));
    if already_bound {
        return;
    }

    info!(
        target: "aura::automation",
        project_id = %ctx.project_id,
        agent_instance_id = %ctx.agent_instance_id,
        task_id = task_id,
        event_type = event_type,
        "implicit task_started (harness omitted explicit task_started frame)"
    );

    dispatch::task_started_side_effects(ctx, Some(task_id)).await;

    emit_domain_event_with_session(DomainEventInputs {
        state: ctx.state,
        event_type: "task_started",
        project_id: ctx.project_id,
        agent_instance_id: ctx.agent_instance_id,
        session_id: ctx.session_id,
        extra: serde_json::json!({
            "task_id": task_id,
            "implicit": true,
        }),
    });
}

#[cfg(test)]
mod tests {
    use super::IMPLICIT_BIND_KINDS;

    #[test]
    fn implicit_bind_includes_harness_tool_events() {
        assert!(IMPLICIT_BIND_KINDS.contains(&"tool_call_started"));
        assert!(IMPLICIT_BIND_KINDS.contains(&"tool_call_completed"));
        assert!(IMPLICIT_BIND_KINDS.contains(&"text_delta"));
    }

    #[test]
    fn implicit_bind_skips_terminal_lifecycle_kinds() {
        assert!(!IMPLICIT_BIND_KINDS.contains(&"task_started"));
        assert!(!IMPLICIT_BIND_KINDS.contains(&"task_completed"));
    }
}
