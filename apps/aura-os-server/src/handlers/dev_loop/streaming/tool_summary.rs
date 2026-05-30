//! Bounded, operator-facing summaries of harness tool-call event
//! payloads. The harness already ships the tool `input` object (e.g.
//! `{ "command": "cargo test" }` for `run_command`) and the result
//! text on every tool event, but the `aura::automation` logs and the
//! SidekickLog `log_line` rows historically recorded only the tool
//! *name*. That made a tool that runs to the hard per-tool timeout
//! opaque: the operator saw `tool=run_command` with no command and no
//! failure text.
//!
//! These pure helpers extract a single, length-capped field from an
//! event so the start/completion log lines can show *what* ran and
//! *how* it failed without dumping an unbounded payload onto one log
//! line. They are shared by the forwarder's trace line
//! ([`super::forwarder`]), the side-effects completion line
//! ([`super::side_effects::dispatch`]), and the `log_line` mapper
//! ([`super::side_effects::log_lines`]).

use serde_json::Value;

/// Max characters surfaced for any single summary field. Mirrors the
/// bounded-payload discipline of `top_level_keys`: a pathologically
/// wide command or result can't blow up a single log line.
const SUMMARY_CAP: usize = 200;

/// Human-readable, length-capped summary of a tool call's `input`,
/// suitable for a single tracing / log-line field.
///
/// Precedence: the `run_command` `command`, then a file `path`, then
/// a comma-joined list of the input keys so the operator at least
/// sees the argument shape. Tolerates the stringified-input shape
/// some harness frames emit. Returns `None` when there is no usable
/// input -- e.g. a bare `tool_use_start` whose args have not streamed
/// in yet (the collector seeds those with an empty object).
pub(crate) fn tool_input_summary(event: &Value) -> Option<String> {
    let input = event.get("input")?;
    let owned;
    let obj = match input {
        Value::Object(map) => map,
        Value::String(raw) => {
            owned = serde_json::from_str::<Value>(raw).ok()?;
            owned.as_object()?
        }
        _ => return None,
    };
    if obj.is_empty() {
        return None;
    }
    if let Some(command) = obj.get("command").and_then(Value::as_str) {
        return Some(truncate(command));
    }
    if let Some(path) = obj.get("path").and_then(Value::as_str) {
        return Some(truncate(path));
    }
    let mut joined = String::new();
    for (i, key) in obj.keys().enumerate() {
        if i > 0 {
            joined.push(',');
        }
        joined.push_str(key);
    }
    Some(truncate(&joined))
}

/// Length-capped preview of a completed tool call's result/error
/// text. Uses the same key precedence as the task-output sync
/// classifier's `event_reason` so the two never drift. Returns `None`
/// when no result text is present.
pub(crate) fn tool_result_preview(event: &Value) -> Option<String> {
    ["reason", "message", "error", "result", "result_preview"]
        .into_iter()
        .find_map(|key| event.get(key).and_then(Value::as_str))
        .filter(|text| !text.is_empty())
        .map(truncate)
}

/// `duration_ms` from a completed tool call payload, if the harness
/// stamped one. Surfaced so a tool that runs to the hard per-tool
/// timeout (e.g. 120000ms) is legible at a glance.
pub(crate) fn event_duration_ms(event: &Value) -> Option<u64> {
    event.get("duration_ms").and_then(Value::as_u64)
}

/// Truncate on a char boundary with a trailing ellipsis, matching the
/// `top_level_keys` marker convention.
fn truncate(text: &str) -> String {
    if text.chars().count() <= SUMMARY_CAP {
        return text.to_string();
    }
    let truncated: String = text.chars().take(SUMMARY_CAP).collect();
    format!("{truncated}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn input_summary_prefers_command() {
        let event =
            json!({ "name": "run_command", "input": { "command": "cargo test --workspace" } });
        assert_eq!(
            tool_input_summary(&event).as_deref(),
            Some("cargo test --workspace")
        );
    }

    #[test]
    fn input_summary_falls_back_to_path() {
        let event =
            json!({ "name": "edit_file", "input": { "path": "src/lib.rs", "new_text": "x" } });
        assert_eq!(tool_input_summary(&event).as_deref(), Some("src/lib.rs"));
    }

    #[test]
    fn input_summary_falls_back_to_key_list() {
        let event = json!({ "name": "submit_plan", "input": { "approach": "fix", "files": [] } });
        assert_eq!(
            tool_input_summary(&event).as_deref(),
            Some("approach,files")
        );
    }

    #[test]
    fn input_summary_parses_stringified_input() {
        let event = json!({ "name": "run_command", "input": "{\"command\":\"ls -la\"}" });
        assert_eq!(tool_input_summary(&event).as_deref(), Some("ls -la"));
    }

    #[test]
    fn input_summary_is_none_when_empty_or_missing() {
        assert_eq!(tool_input_summary(&json!({ "name": "read_file" })), None);
        assert_eq!(
            tool_input_summary(&json!({ "name": "read_file", "input": {} })),
            None
        );
    }

    #[test]
    fn input_summary_truncates_long_command() {
        let long = "a".repeat(SUMMARY_CAP + 50);
        let event = json!({ "input": { "command": long } });
        let summary = tool_input_summary(&event).expect("summary");
        assert_eq!(summary.chars().count(), SUMMARY_CAP + 1);
        assert!(summary.ends_with('…'));
    }

    #[test]
    fn result_preview_respects_key_precedence() {
        // `reason` wins over the later keys.
        let event = json!({ "reason": "Tool timed out after 120000ms", "result": "ignored" });
        assert_eq!(
            tool_result_preview(&event).as_deref(),
            Some("Tool timed out after 120000ms")
        );
        // Falls through to `result` when the earlier keys are absent.
        let event = json!({ "result": "ok" });
        assert_eq!(tool_result_preview(&event).as_deref(), Some("ok"));
    }

    #[test]
    fn result_preview_is_none_when_absent_or_empty() {
        assert_eq!(tool_result_preview(&json!({ "is_error": true })), None);
        assert_eq!(tool_result_preview(&json!({ "reason": "" })), None);
    }

    #[test]
    fn duration_ms_reads_numeric_field() {
        assert_eq!(
            event_duration_ms(&json!({ "duration_ms": 120000 })),
            Some(120000)
        );
        assert_eq!(event_duration_ms(&json!({})), None);
    }
}
