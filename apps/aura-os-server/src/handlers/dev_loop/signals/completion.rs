//! Completion-validation no-op stubs and `task_done`/file-edit predicates used by the legacy phase7 test surface.

pub(crate) fn completion_validation_failure_reason(
    _live_output: &str,
    _files_changed: &[&str],
    _n_build_steps: usize,
    _n_test_steps: usize,
    _n_format_steps: usize,
    _n_lint_steps: usize,
) -> Option<String> {
    None
}

pub(crate) fn completion_validation_failure_reason_with_empty_path_writes(
    _live_output: &str,
    _files_changed: &[&str],
    _n_build_steps: usize,
    _n_test_steps: usize,
    _n_format_steps: usize,
    _n_lint_steps: usize,
    _n_empty_path_writes: u32,
) -> Option<String> {
    // The harness owns Definition-of-Done and decides whether a task is
    // complete. aura-os only records and displays the evidence it receives.
    None
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn completion_validation_failure_reason_with_tool_call_failures(
    _live_output: &str,
    _files_changed: &[&str],
    _n_build_steps: usize,
    _n_test_steps: usize,
    _n_format_steps: usize,
    _n_lint_steps: usize,
    _n_empty_path_writes: u32,
    _tool_call_failures: &[(&str, &str)],
) -> Option<String> {
    None
}

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
/// [`aura_os_automation::classify_delta`] when the gate should
/// reject the completion, or `None` to defer to the existing
/// `task_done_missing_file_changes_reason` gate.
///
/// * `event_type` + `event` — the `tool_call_completed` payload for
///   the `task_done` call. Errored, non-`task_done`, and
///   `no_changes_needed: true` events return `None` so the existing
///   gates own those paths.
/// * `baseline` — the [`aura_os_automation::WorkspaceHealth`] snapshot
///   captured at task claim. `None` means "no baseline", which
///   always returns `None` (defers to the existing gate).
/// * `current` — the post-task snapshot. When `Some(baseline)` is
///   present but `current` is `None` (e.g. the post-task snapshot
///   was skipped for latency), the gate treats `current` as a clone
///   of `baseline` so the diff classifies as `Unchanged` and the
///   gate does not block.
pub(crate) fn task_done_workspace_health_gate_reason(
    event_type: &str,
    event: &serde_json::Value,
    baseline: Option<&aura_os_automation::WorkspaceHealth>,
    current: Option<&aura_os_automation::WorkspaceHealth>,
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

    let delta = aura_os_automation::classify_delta(baseline, current);
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
