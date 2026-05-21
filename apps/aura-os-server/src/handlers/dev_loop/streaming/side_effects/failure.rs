//! Failure-reason extraction, synthesis, and persistence for `task_failed` events.

use tracing::warn;

use aura_os_automation::{synthesize_failure_reason, FailureContext};
use aura_os_storage::UpdateTaskRequest;

use crate::state::AppState;

/// Extract the fail reason from a `task_failed` event. Checks the same
/// field order as `event_message` (`reason`/`message`/`error`/`code`)
/// and returns `None` when all are missing or empty — callers can
/// decide whether to fall back to the generic "Automaton execution
/// failed" string or skip the write entirely.
///
/// Trims whitespace so we don't persist empty strings or pure-space
/// payloads as if they were real reasons.
pub(crate) fn extract_task_failure_reason(event: &serde_json::Value) -> Option<String> {
    for key in ["reason", "message", "error", "code"] {
        if let Some(value) = event.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Best-effort write of `tasks.execution_notes` from the reason field
/// of a `task_failed` event. Intentionally non-fatal: failures (no
/// storage client configured, expired JWT, network blip) are logged at
/// `warn` level and the caller continues. Callers only hit this path
/// after already forwarding the event to live subscribers, so the
/// reload-visible state is strictly better-off than before regardless
/// of outcome.
///
/// Section B: when the event lacks a usable reason
/// ([`extract_task_failure_reason`] returns `None`), we synthesize a
/// descriptive fallback via
/// [`aura_os_automation::synthesize_failure_reason`] so the
/// persisted `execution_notes` is always non-empty for a failed
/// task. The fallback is built from whatever context the event
/// itself carries (`terminal_state`, last tool name, error excerpt)
/// — the live-output tail is not consulted here to keep this
/// function lock-free.
pub(super) async fn persist_task_failure_reason(
    state: &AppState,
    jwt: &str,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    let reason = resolve_failure_reason_for_persistence(event);
    let update = UpdateTaskRequest {
        execution_notes: Some(reason),
        ..Default::default()
    };
    if let Err(error) = storage.update_task(task_id, jwt, &update).await {
        warn!(
            %task_id,
            %error,
            "failed to persist task_failed reason to tasks.execution_notes"
        );
    }
}

/// Resolve the string to persist into `tasks.execution_notes`.
///
/// Pure helper: returns the trimmed extracted reason when the event
/// carries one, otherwise synthesizes a fallback via
/// [`aura_os_automation::synthesize_failure_reason`]. Never returns
/// an empty string — Section B regression: a silent `task_failed`
/// must still leave actionable text on the row.
pub(crate) fn resolve_failure_reason_for_persistence(event: &serde_json::Value) -> String {
    if let Some(reason) = extract_task_failure_reason(event) {
        return reason;
    }
    let ctx = build_failure_context_from_event(event);
    synthesize_failure_reason(&ctx)
}

/// Build a [`FailureContext`] from whatever fields a `task_failed`
/// event payload carries. The harness shape varies: some emits
/// `terminal_state`, others `state`; some surface the last tool via
/// `tool_name` while others use `last_tool` or fold it into the
/// `reason` string. We try every observed key and degrade to `None`
/// when nothing is available — the synthesizer treats every absent
/// field as "skip this clause".
pub(super) fn build_failure_context_from_event(event: &serde_json::Value) -> FailureContext {
    let read_str = |keys: &[&str]| -> Option<String> {
        for key in keys {
            if let Some(value) = event.get(*key).and_then(|v| v.as_str()) {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    };

    FailureContext {
        real_reason: None,
        terminal_state: read_str(&["terminal_state", "state", "harness_state"]),
        last_tool_name: read_str(&["last_tool", "last_tool_name", "tool_name", "tool"]),
        last_error_excerpt: read_str(&["last_error", "last_error_excerpt", "error_tail"]),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_failure_context_from_event, resolve_failure_reason_for_persistence};
    use serde_json::json;

    // ====================================================================
    // Section B regression: silent `task_failed` events synthesise a
    // descriptive `execution_notes` body even when no `reason` /
    // `message` / `error` / `code` field is present on the event. The
    // test pins `resolve_failure_reason_for_persistence` (the helper
    // that the `task_failed` arm's persist call now feeds) — the
    // synthesis itself is unit-tested in `aura_os_automation::failure`.
    // ====================================================================

    #[test]
    fn silent_task_failed_synthesises_execution_notes() {
        let event = json!({
            "type": "task_failed",
            "task_id": "00000000-0000-0000-0000-000000000000",
            "terminal_state": "stream_closed",
            "last_tool": "edit_file",
            "last_error": "stream terminated mid tool_use",
        });
        let reason = resolve_failure_reason_for_persistence(&event);
        assert!(
            !reason.is_empty(),
            "Section B regression: silent task_failed must persist a non-empty reason"
        );
        assert!(
            reason.starts_with("task failed: stream_closed"),
            "synthesised reason should lead with the harness terminal state, got {reason:?}",
        );
        assert!(
            reason.contains("last tool edit_file"),
            "synthesised reason should mention the last tool, got {reason:?}",
        );
        assert!(
            reason.contains("stream terminated mid tool_use"),
            "synthesised reason should include the error excerpt, got {reason:?}",
        );
    }

    #[test]
    fn task_failed_with_real_reason_does_not_synthesise() {
        let event = json!({
            "type": "task_failed",
            "task_id": "00000000-0000-0000-0000-000000000000",
            "reason": "real reason from harness",
            // These extras must be ignored when a real reason exists.
            "terminal_state": "stream_closed",
            "last_tool": "edit_file",
        });
        let reason = resolve_failure_reason_for_persistence(&event);
        assert_eq!(
            reason, "real reason from harness",
            "extracted reason must short-circuit synthesis",
        );
    }

    #[test]
    fn build_failure_context_picks_first_populated_alias() {
        // The harness occasionally emits `state` instead of
        // `terminal_state` and `tool_name` instead of `last_tool`;
        // both must reach the synthesizer's slots.
        let event = json!({
            "type": "task_failed",
            "state": "timeout",
            "tool_name": "run_command",
            "error_tail": "timeout after 60s",
        });
        let ctx = build_failure_context_from_event(&event);
        assert_eq!(ctx.terminal_state.as_deref(), Some("timeout"));
        assert_eq!(ctx.last_tool_name.as_deref(), Some("run_command"));
        assert_eq!(ctx.last_error_excerpt.as_deref(), Some("timeout after 60s"));
        assert!(ctx.real_reason.is_none());
    }

    #[test]
    fn fully_silent_task_failed_yields_unknown_sentinel_not_empty_string() {
        // The pathological case: harness drops the connection before
        // populating any reason field. The persisted row must still
        // carry actionable text instead of the pre-G3a empty
        // `execution_notes`.
        let event = json!({
            "type": "task_failed",
            "task_id": "00000000-0000-0000-0000-000000000000",
        });
        let reason = resolve_failure_reason_for_persistence(&event);
        assert!(!reason.is_empty());
        assert!(
            reason.contains("unknown"),
            "all-empty event must surface the unknown sentinel, got {reason:?}",
        );
    }
}
