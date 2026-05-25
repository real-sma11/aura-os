//! `task_done`/file-edit predicates and workspace-health gate used by the dev-loop and the legacy phase7 test surface.

pub(crate) fn is_empty_path_write_event(
    event_type: &str,
    event: &serde_json::Value,
) -> bool {
    if event_type != "tool_call_completed" {
        return false;
    }
    let name = event
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    matches!(name, "write_file" | "edit_file") && path_from_input(event).is_none()
}

pub(crate) fn successful_write_event_path(
    event_type: &str,
    event: &serde_json::Value,
) -> Option<(String, &'static str)> {
    if event_type != "tool_call_completed"
        || event.get("is_error").and_then(|v| v.as_bool()) == Some(true)
    {
        return None;
    }
    let name = event.get("name").and_then(|value| value.as_str())?;
    let op = match name {
        "write_file" => "modify",
        "edit_file" => "modify",
        "delete_file" => "delete",
        _ => return None,
    };
    path_from_input(event).map(|path| (path, op))
}

pub(crate) fn task_done_declares_no_changes_needed(
    event_type: &str,
    event: &serde_json::Value,
) -> bool {
    event_type == "tool_call_completed"
        && event.get("is_error").and_then(|v| v.as_bool()) != Some(true)
        && event.get("name").and_then(|value| value.as_str()) == Some("task_done")
        && event
            .get("input")
            .and_then(|input| input.get("no_changes_needed"))
            .and_then(|value| value.as_bool())
            == Some(true)
}

pub(crate) fn task_done_missing_file_changes_reason(
    event_type: &str,
    event: &serde_json::Value,
    files_changed: &[&str],
) -> Option<&'static str> {
    if event_type != "tool_call_completed"
        || event.get("is_error").and_then(|v| v.as_bool()) == Some(true)
        || event.get("name").and_then(|value| value.as_str()) != Some("task_done")
        || !files_changed.is_empty()
        || task_done_declares_no_changes_needed(event_type, event)
    {
        return None;
    }

    Some("task_done_without_file_changes")
}

/// Workspace-health diff gate for `task_done`.
///
/// Returns the blocking verdict reason emitted by
/// [`super::super::health::classify_delta`] when the gate should
/// reject the completion, or `None` to defer to the existing
/// `task_done_missing_file_changes_reason` gate.
///
/// * `event_type` + `event` -- the `tool_call_completed` payload for
///   the `task_done` call. Errored, non-`task_done`, and
///   `no_changes_needed: true` events return `None` so the existing
///   gates own those paths.
/// * `baseline` -- the `WorkspaceHealth` snapshot captured at task
///   claim. `None` means "no baseline", which always returns `None`
///   (defers to the existing gate).
/// * `current` -- the post-task snapshot. When `Some(baseline)` is
///   present but `current` is `None` (e.g. the post-task snapshot
///   was skipped for latency), the gate treats `current` as a clone
///   of `baseline` so the diff classifies as `Unchanged` and the
///   gate does not block.
pub(crate) fn task_done_workspace_health_gate_reason(
    event_type: &str,
    event: &serde_json::Value,
    baseline: Option<&super::super::health::WorkspaceHealth>,
    current: Option<&super::super::health::WorkspaceHealth>,
) -> Option<&'static str> {
    if event_type != "tool_call_completed"
        || event.get("is_error").and_then(|v| v.as_bool()) == Some(true)
        || event.get("name").and_then(|value| value.as_str()) != Some("task_done")
        || task_done_declares_no_changes_needed(event_type, event)
    {
        return None;
    }

    let baseline = baseline?;
    let current_owned;
    let current = match current {
        Some(current) => current,
        None => {
            current_owned = baseline.clone();
            &current_owned
        }
    };

    let delta = super::super::health::classify_delta(baseline, current);
    if delta.verdict.blocks_task_done() {
        Some(delta.reason)
    } else {
        None
    }
}

fn path_from_input(event: &serde_json::Value) -> Option<String> {
    event
        .get("input")
        .and_then(|input| input.get("path"))
        .and_then(|path| path.as_str())
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string)
}