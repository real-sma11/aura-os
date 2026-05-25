//! Side-channel `log_line` surfacing for engine events the SidekickLog
//! panel does not otherwise subscribe to. Pure mappers from event
//! payloads to log-line text, plus the high-frequency throttle key
//! lookup. Splitting these out of the orchestrator keeps mod.rs
//! within the per-file size budget without losing the explicit
//! contract that the panel's live subscription set (`ALL_ENGINE_EVENT_TYPES`
//! in `interface/src/hooks/use-log-stream.ts`) and the persistence
//! allowlist (`crate::persistence::LOG_WORTHY_TYPES`) both rely on.

use aura_os_core::{AgentInstanceId, ProjectId, SessionId};

use super::super::emit_log_line;
use crate::log_throttle::{self, LogThrottleKey};
use crate::state::AppState;

/// Surface free-text `log_line` rows for engine events that the
/// SidekickLog panel's subscription set (`ALL_ENGINE_EVENT_TYPES` in
/// `interface/src/hooks/use-log-stream.ts`) does not otherwise
/// cover. Without these, an active run looks idle between coarse
/// engine milestones (task_started -> file_ops_applied ->
/// build_passed) because the LLM can spend tens of seconds streaming
/// text and dispatching tools while the panel renders nothing.
///
/// Each emission goes through [`emit_log_line`] so it lands on the
/// same `event_broadcast` and topic-scoped hub as the typed events;
/// the persistence allowlist already includes `log_line` so history
/// reloads pick these up too.
///
/// High-frequency channels (`text_delta`) are rate-limited via the
/// process-wide [`crate::log_throttle`] singleton so a single fast
/// turn cannot drown the panel.
pub(super) fn surface_log_lines_for_event(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    event_type: &str,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    let Some(message) = log_line_for_event(event_type, event) else {
        return;
    };
    if let Some(channel) = throttle_channel_for(event_type) {
        let key = LogThrottleKey::new(
            project_id.to_string(),
            agent_instance_id.to_string(),
            channel,
        );
        if !log_throttle::should_emit(key) {
            return;
        }
    }
    let extra = task_id.map_or_else(
        || serde_json::json!({}),
        |task_id| serde_json::json!({ "task_id": task_id }),
    );
    emit_log_line(
        state,
        project_id,
        agent_instance_id,
        session_id,
        message,
        extra,
    );
}

/// Pure mapping from an engine event into the optional `log_line`
/// message text the panel should render. `None` means "no log_line
/// for this event type" --- most events fall through to the existing
/// engine-event row in the panel and don't need a parallel `LOG`
/// row. Split out from [`surface_log_lines_for_event`] so the
/// per-event rendering can be exercised in a unit test without
/// standing up an [`AppState`].
pub(crate) fn log_line_for_event(event_type: &str, event: &serde_json::Value) -> Option<String> {
    match event_type {
        "tool_call_started" | "tool_use_start" => {
            Some(format!("Calling tool: {}", tool_name_for_log(event)))
        }
        "tool_call_completed" => {
            let name = tool_name_for_log(event);
            let suffix = if event
                .get("is_error")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                " (error)"
            } else {
                ""
            };
            Some(format!("Tool completed: {name}{suffix}"))
        }
        "text_delta" => Some("Streaming response...".to_string()),
        "assistant_message_end" => Some(match assistant_turn_tokens(event) {
            (Some(input), Some(output)) => {
                format!("Turn ended ({input} in / {output} out tokens)")
            }
            _ => "Turn ended".to_string(),
        }),
        _ => None,
    }
}

/// Return the throttle channel discriminator for an event type, or
/// `None` when the event should always emit. Channels are
/// `&'static str` so the throttle key remains allocation-free.
///
/// `text_delta` is the only high-frequency channel --- the harness
/// streams hundreds per turn --- so it is the only event throttled by
/// default. Tool-call lifecycle events fire once per call, so they
/// pass through every time.
fn throttle_channel_for(event_type: &str) -> Option<&'static str> {
    match event_type {
        "text_delta" => Some("text_delta"),
        _ => None,
    }
}

/// First populated string among the harness's tool-name aliases.
/// Defaults to `"tool"` so the row stays readable when the harness
/// omits the name field entirely.
fn tool_name_for_log(event: &serde_json::Value) -> &str {
    ["name", "tool_name", "tool"]
        .into_iter()
        .find_map(|key| event.get(key).and_then(|value| value.as_str()))
        .filter(|value| !value.is_empty())
        .unwrap_or("tool")
}

/// Extract `(input_tokens, output_tokens)` from an
/// `assistant_message_end` payload. Looks under both the top-level
/// fields the legacy harness emits and the nested `usage` object the
/// current harness uses.
fn assistant_turn_tokens(event: &serde_json::Value) -> (Option<u64>, Option<u64>) {
    let read = |path: &[&str]| -> Option<u64> {
        let mut node = event;
        for key in path {
            node = node.get(key)?;
        }
        node.as_u64()
    };
    let input = read(&["input_tokens"]).or_else(|| read(&["usage", "input_tokens"]));
    let output = read(&["output_tokens"]).or_else(|| read(&["usage", "output_tokens"]));
    (input, output)
}