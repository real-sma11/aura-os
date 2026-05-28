//! Server-side signal helpers: classifier wrappers (typed via
//! `HarnessFailureKind`), failure-context extraction, completion
//! predicates, and test-evidence detection.

mod classifiers;
mod completion;
mod failure_context;
mod health_snapshot;
mod test_evidence;

pub(crate) use health_snapshot::{health_gate_enabled, snapshot_workspace_health};

pub(crate) use classifiers::{
    auto_decompose_disabled, is_agent_stuck_terminal_signal, is_completion_contract_failure,
    is_git_push_timeout_failure, is_insufficient_credits_failure, is_provider_internal_error,
    is_truncation_failure, looks_like_unclassified_transient, should_restart_on_error_event,
};
pub(crate) use completion::{
    is_empty_path_write_event, successful_write_event_path, task_done_declares_no_changes_needed,
    task_done_missing_file_changes_reason, task_done_workspace_health_gate_reason,
};
pub(crate) use failure_context::extract_task_failure_context;
pub(crate) use test_evidence::{is_successful_test_run_event, recognized_test_runner_label};
