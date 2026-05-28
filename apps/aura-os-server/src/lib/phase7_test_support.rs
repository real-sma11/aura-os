/// True when `reason` is classified as a truncation-style failure
/// by Phase 3's `classify_failure`. Anything else -- auth errors,
/// crashes, rate limits -- returns `false`.
pub fn is_truncation_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_truncation_failure(reason)
}

/// True when the harness/task tool rejected `task_done` because an
/// implementation task completed without write/edit/delete evidence and
/// without the explicit `no_changes_needed` escape hatch.
pub fn is_completion_contract_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_completion_contract_failure(reason)
}

/// Parse `reason` through the canonical
/// [`aura_os_harness::signals::classify_failure`] router and return
/// the typed [`aura_os_harness::signals::HarnessFailureKind`].
///
/// Exposed for the Phase 1 cutover so the `dev_loop_dod_regression`
/// suite can assert directly against the typed enum instead of the
/// substring-matching `is_*_failure` shims.
pub fn classify_failure(reason: &str) -> aura_os_harness::signals::HarnessFailureKind {
    aura_os_harness::signals::classify_failure(Some(reason))
}

/// True when `reason` indicates the provider rejected work because the
/// account has no remaining credits. This is terminal for dev loops:
/// retrying or moving to the next task only burns build/setup time.
pub fn is_insufficient_credits_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_insufficient_credits_failure(reason)
}

/// True when `reason` is recognized as a post-commit `git push`
/// timeout. This is the non-fatal infra path: the task can still be
/// marked done because the commit already exists locally.
pub fn is_git_push_timeout_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_git_push_timeout_failure(reason)
}

/// True when `reason` is classified as a transient provider
/// internal error (5xx / stream aborted) -- the class added in
/// Axis 1 so the `LLM error: stream terminated with error:
/// Internal server error` pattern routes through the retry path
/// instead of being treated as terminal.
pub fn is_provider_internal_error(reason: &str) -> bool {
    crate::handlers::dev_loop::is_provider_internal_error(reason)
}

/// True when `reason` text *looks* transient but the classifier
/// didn't match it -- the `debug.retry_miss` trigger condition from
/// Axis 4. Used by integration tests to pin the exact coverage
/// surface of `looks_like_unclassified_transient`.
pub fn looks_like_unclassified_transient(reason: &str) -> bool {
    crate::handlers::dev_loop::looks_like_unclassified_transient(reason)
}

/// True when `reason` is a terminal agent-side anti-waste signal
/// from the harness (consecutive-error guard, "appears stuck",
/// "stopping to prevent waste"). The error-event handler uses this
/// to skip the restart path because restarting a harness that has
/// already decided to stop just tight-loops on a WS reconnect.
pub fn is_agent_stuck_terminal_signal(reason: &str) -> bool {
    crate::handlers::dev_loop::is_agent_stuck_terminal_signal(reason)
}

/// True when an `error`-event reason from the harness should
/// trigger an automaton restart. Restart iff the reason is
/// actually transient (classified or unclassified-transient
/// heuristic) **and** is not a terminal agent-stuck signal.
pub fn should_restart_on_error_event(reason: &str) -> bool {
    crate::handlers::dev_loop::should_restart_on_error_event(reason)
}

/// True when the harness streamed a `write_file` / `edit_file`
/// `tool_call_completed` event with a missing or empty `path`.
/// Those events cannot land on disk and are retained as diagnostic
/// history; the harness owns any resulting completion decision.
///
/// Started/snapshot events are intentionally ignored so a single
/// malformed call is only counted once.
pub fn is_empty_path_write_event(event_type: &str, event: &serde_json::Value) -> bool {
    crate::handlers::dev_loop::is_empty_path_write_event(event_type, event)
}

/// Extracts `(path, op)` for a successful
/// `tool_call_completed` representing a `write_file`,
/// `edit_file`, or `delete_file` with a real path. The returned
/// `op` is one of `"create" | "modify" | "delete"` (aligned with
/// `StorageTaskFileChangeSummary::op`).
///
/// This is the fallback signal aura-os uses to populate
/// `files_changed` when the upstream `assistant_message_end` did
/// not carry a `files_changed` payload.
pub fn successful_write_event_path(
    event_type: &str,
    event: &serde_json::Value,
) -> Option<(String, &'static str)> {
    crate::handlers::dev_loop::successful_write_event_path(event_type, event)
}

/// True when a successful `task_done` tool completion explicitly declares
/// that no file edits were required for the task.
pub fn task_done_declares_no_changes_needed(event_type: &str, event: &serde_json::Value) -> bool {
    crate::handlers::dev_loop::task_done_declares_no_changes_needed(event_type, event)
}

/// Returns a stable diagnostic label when a successful `task_done` call
/// lacks both file-change evidence and `no_changes_needed: true`.
pub fn task_done_missing_file_changes_reason(
    event_type: &str,
    event: &serde_json::Value,
    files_changed: &[&str],
) -> Option<&'static str> {
    crate::handlers::dev_loop::task_done_missing_file_changes_reason(
        event_type,
        event,
        files_changed,
    )
}

/// Workspace-health diff gate for `task_done`.
///
/// Public shim around the in-crate
/// `task_done_workspace_health_gate_reason` predicate so the
/// `dev_loop_dod_regression` test suite can exercise the gate
/// without reaching into private handler internals.
///
/// Returns the blocking `HealthDelta::reason` string when the gate
/// rejects, `None` when it accepts (including the no-baseline
/// back-compat path).
pub fn task_done_workspace_health_gate_reason(
    event_type: &str,
    event: &serde_json::Value,
    baseline: Option<&crate::handlers::dev_loop::health::WorkspaceHealth>,
    current: Option<&crate::handlers::dev_loop::health::WorkspaceHealth>,
) -> Option<&'static str> {
    crate::handlers::dev_loop::task_done_workspace_health_gate_reason(
        event_type, event, baseline, current,
    )
}

/// Re-export of the moved-in workspace-health module so the
/// `dev_loop_dod_regression` tests can name `WorkspaceHealth` and
/// friends without an extra dev-dependency declaration. The alias
/// `automation` matches the idiom used in other test-support
/// re-exports.
pub mod automation {
    pub use crate::handlers::dev_loop::health::{
        classify_delta, BuildStatus, HealthDelta, HealthError, HealthVerdict, TestStatus,
        WorkspaceHealth,
    };
}

/// Preflight a local workspace directory the way the dev-loop would
/// when starting a task. Returns `Ok(())` if the workspace is
/// usable (or eligible for auto-clone via `git_repo_url`), and the
/// remediation hint string otherwise.
///
/// Mirrors the logic of the private `preflight_local_workspace` fn
/// in `handlers::dev_loop::start::mod`, which is the production
/// caller. Kept here as a string-error surface so the
/// `dev_loop_dod_regression::preflight` tests can exercise the gate
/// without a live `ApiError` / `HarnessMode` plumbing dependency.
pub fn preflight_local_workspace(
    project_path: &str,
    git_repo_url: Option<&str>,
) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Err("workspace path is empty".to_string());
    }
    let path = std::path::Path::new(project_path);
    match crate::handlers::projects_helpers::validate_workspace_is_initialised(path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let bootstrap_pending = git_repo_url.is_some_and(|url| !url.trim().is_empty());
            if bootstrap_pending
                && matches!(
                    err,
                    crate::handlers::projects_helpers::WorkspacePreflightError::Empty
                        | crate::handlers::projects_helpers::WorkspacePreflightError::NotAGitRepo
                )
            {
                Ok(())
            } else {
                Err(err.remediation_hint(path))
            }
        }
    }
}

/// Run Phase 5's preflight decomposition detector against a
/// prospective task's `(title, description)`. Returns
/// `Some((reason_label, target_path))` when the heuristic would
/// trigger a skeleton+fill split, `None` otherwise.
pub fn preflight_decomposition_reason(
    title: &str,
    description: &str,
) -> Option<(String, Option<String>)> {
    crate::handlers::task_decompose::preflight_decomposition_reason(title, description)
}

pub fn sync_state_from_git_steps(git_steps: &[serde_json::Value]) -> serde_json::Value {
    serde_json::to_value(crate::sync_state::derive_sync_state(git_steps))
        .unwrap_or_else(|_| serde_json::json!({}))
}

pub fn recovery_point_from_git_steps(git_steps: &[serde_json::Value]) -> Option<serde_json::Value> {
    let sync_state = crate::sync_state::derive_sync_state(git_steps);
    crate::sync_state::derive_recovery_point(&sync_state)
        .and_then(|point| serde_json::to_value(point).ok())
}

/// Run the reconciler's pure decision engine against a synthetic
/// task recovery context and return the chosen action as a small
/// JSON payload. Exposed so integration tests and downstream
/// supervisors can exercise the decision table without depending
/// on the server's private module layout.
///
/// `failure_class` accepts one of `"none"`, `"truncation"`,
/// `"rate_limited"`, `"push_timeout"`, `"other"`. Anything else is
/// treated as `"other"`.
///
/// A `max_retries` of `0` is treated as "use the default"
/// ([`crate::reconciler::DEFAULT_MAX_RETRIES_PER_TASK`]) so callers
/// that don't yet persist a per-task budget stay in lockstep with
/// `handlers::dev_loop`'s `MAX_RETRIES_PER_TASK`.
/// Extract the structured provider-failure context that the dev loop
/// plumbs onto `task_failed` events, in the exact shape the UI sees:
/// a JSON object with optional `provider_request_id`, `model`,
/// `sse_error_type`, and `message_id` siblings next to the human-
/// readable `reason`.
///
/// `event_sibling_fields` is merged into the synthetic `task_failed`
/// event *before* context extraction, so callers can exercise both
/// the "harness emitted structured siblings" path and the
/// "classic reason-string-only" fallback through a single entry
/// point. Pass `None` to exercise the fallback path on its own.
///
/// The returned payload is the same object the UI decodes (see
/// `interface/src/stores/task-stream-bootstrap.ts::handleTaskFailed`),
/// so integration tests can assert against the full wire shape
/// without reaching into private handler internals.
pub fn task_failed_payload_with_context(
    task_id: &str,
    reason: &str,
    event_sibling_fields: Option<&serde_json::Map<String, serde_json::Value>>,
) -> serde_json::Value {
    let mut synthetic = serde_json::json!({
        "task_id": task_id,
        "reason": reason,
    });
    if let Some(extra) = event_sibling_fields {
        if let Some(obj) = synthetic.as_object_mut() {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    let ctx = crate::handlers::dev_loop::extract_task_failure_context(&synthetic, Some(reason));
    if ctx.has_any() {
        if let Some(obj) = synthetic.as_object_mut() {
            ctx.merge_into(obj);
        }
    }
    synthetic
}

pub fn reconcile_decision(
    git_steps: &[serde_json::Value],
    failure_class: &str,
    retry_count: u32,
    max_retries: u32,
    has_live_automaton: bool,
) -> serde_json::Value {
    reconcile_decision_with_test_evidence(
        git_steps,
        failure_class,
        retry_count,
        max_retries,
        has_live_automaton,
        false,
    )
}

/// Same as [`reconcile_decision`] but lets tests opt the
/// "tests-as-truth" gate on by passing `has_test_pass_evidence: true`.
/// When the failure is a `CompletionContract`, this rewrites the
/// terminal verdict into a successful `mark_done` with reason
/// `test_evidence_accepted`. Other failure classes are unaffected.
pub fn reconcile_decision_with_test_evidence(
    git_steps: &[serde_json::Value],
    failure_class: &str,
    retry_count: u32,
    max_retries: u32,
    has_live_automaton: bool,
    has_test_pass_evidence: bool,
) -> serde_json::Value {
    let sync_state = crate::sync_state::derive_sync_state(git_steps);
    let recovery_point = crate::sync_state::derive_recovery_point(&sync_state);
    let failure_signal = match failure_class {
        "none" => None,
        "truncation" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
            task_id: None,
            reason: Some("truncation".to_string()),
            failure: aura_os_harness::signals::HarnessFailureKind::Truncation,
        }),
        "rate_limited" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
            task_id: None,
            reason: Some("rate_limited".to_string()),
            failure: aura_os_harness::signals::HarnessFailureKind::RateLimited,
        }),
        "completion_contract" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
            task_id: None,
            reason: Some("task_done_without_file_changes".to_string()),
            failure: aura_os_harness::signals::HarnessFailureKind::CompletionContract,
        }),
        "push_timeout" => Some(aura_os_harness::signals::HarnessSignal::GitPushFailed {
            task_id: None,
            commit_sha: None,
            reason: Some("git push timeout".to_string()),
        }),
        _ => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
            task_id: None,
            reason: Some("other".to_string()),
            failure: aura_os_harness::signals::HarnessFailureKind::Other,
        }),
    };
    let effective_max = if max_retries == 0 {
        crate::reconciler::DEFAULT_MAX_RETRIES_PER_TASK
    } else {
        max_retries
    };
    let mut inputs = crate::reconciler::ReconcileInputs::from_sync_state(&sync_state);
    inputs.recovery_point = recovery_point.as_ref();
    inputs.retry_count = retry_count;
    inputs.max_retries = effective_max;
    inputs.latest_signal = failure_signal.as_ref();
    inputs.has_live_automaton = has_live_automaton;
    inputs.has_test_pass_evidence = has_test_pass_evidence;
    crate::reconciler::decide_reconcile_action(&inputs).to_json()
}

/// Re-export of the test-evidence detector so external integration
/// tests can exercise the same recognizer the dev-loop uses without
/// reaching into private handler internals.
pub fn is_successful_test_run_event(event_type: &str, event: &serde_json::Value) -> bool {
    crate::handlers::dev_loop::is_successful_test_run_event(event_type, event)
}

/// Re-export of the recognizer label so tests can verify which runner
/// satisfied [`is_successful_test_run_event`].
pub fn recognized_test_runner_label(command: &str) -> Option<&'static str> {
    crate::handlers::dev_loop::recognized_test_runner_label(command)
}
