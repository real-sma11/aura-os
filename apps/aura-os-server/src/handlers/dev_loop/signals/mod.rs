//! Server-side signal helpers: classifier wrappers (typed via
//! `HarnessFailureKind`), failure-context extraction, completion-validation
//! stubs, test-evidence detection, push-failure heuristics, and preflight.

mod build_preflight;
mod classifiers;
mod completion;
mod failure_context;
mod health_snapshot;
mod preflight;
mod push_failures;
mod test_evidence;

pub(crate) use build_preflight::{
    build_gate_enabled, render_demoted_failure_reason, run_build_preflight, BuildPreflight,
};
pub(crate) use health_snapshot::{health_gate_enabled, snapshot_workspace_health};

pub(crate) use classifiers::{
    auto_decompose_disabled, classify_push_failure, is_agent_stuck_terminal_signal,
    is_completion_contract_failure, is_git_push_timeout_failure,
    is_insufficient_credits_failure, is_provider_internal_error, is_rate_limited_failure,
    is_truncation_failure, looks_like_unclassified_transient, should_restart_on_error_event,
    tool_call_failed_should_retry, tool_call_retry_budget,
};
pub(crate) use completion::{
    completion_validation_failure_reason, completion_validation_failure_reason_with_empty_path_writes,
    completion_validation_failure_reason_with_tool_call_failures, is_empty_path_write_event,
    successful_write_event_path, task_done_declares_no_changes_needed,
    task_done_missing_file_changes_reason, task_done_workspace_health_gate_reason,
};
pub(crate) use failure_context::extract_task_failure_context;
pub(crate) use preflight::preflight_local_workspace;
pub(crate) use push_failures::{
    build_dod_followup_prompt, bump_project_push_failures_streak, classify_dod_remediation_kind,
    max_dod_retries_per_task, push_failure_reset_rearms_stuck_emission, recovery_checkpoint,
    should_task_complete_despite_push_failure, CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD,
};
pub(crate) use test_evidence::{is_successful_test_run_event, recognized_test_runner_label};
