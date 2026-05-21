mod adapter;
mod control;
mod registry;
mod session;
mod signals;
mod start;
mod streaming;
mod types;

pub(crate) use adapter::{
    emit_domain_event, get_loop_status, pause_loop, resume_loop, run_single_task, start_loop,
    stop_loop,
};
pub(crate) use signals::{
    auto_decompose_disabled, build_dod_followup_prompt, bump_project_push_failures_streak,
    classify_dod_remediation_kind, classify_push_failure, completion_validation_failure_reason,
    completion_validation_failure_reason_with_empty_path_writes,
    completion_validation_failure_reason_with_tool_call_failures, extract_task_failure_context,
    is_agent_stuck_terminal_signal, is_completion_contract_failure, is_empty_path_write_event,
    is_git_push_timeout_failure, is_insufficient_credits_failure, is_provider_internal_error,
    is_rate_limited_failure, is_successful_test_run_event, is_truncation_failure,
    looks_like_unclassified_transient, max_dod_retries_per_task, preflight_local_workspace,
    push_failure_reset_rearms_stuck_emission, recognized_test_runner_label, recovery_checkpoint,
    should_restart_on_error_event, should_task_complete_despite_push_failure,
    successful_write_event_path, task_done_declares_no_changes_needed,
    task_done_missing_file_changes_reason, task_done_workspace_health_gate_reason,
    tool_call_failed_should_retry, tool_call_retry_budget, CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD,
};
