//! Harness-owned DoD and retired aura-os DoD remediation surface
//! regressions.
//!
//! Tool-level retries are the harness's job (it sees every tool
//! result and owns the retry policy); the server does not carry a
//! parallel tool-call retry budget or tracker. The tests in this
//! file pin the harness-owned DoD surface, the typed
//! `HarnessFailureKind` classifier, and the reconciler decision
//! table.

use aura_os_server::phase7_test_support as tsp;
use serde_json::json;

#[test]
fn insufficient_credits_reason_is_terminal_at_classifier_layer() {
    let reason = "agent execution error: LLM error: kernel reason_streaming error: reasoner error: Insufficient credits: Anthropic API error: 402 Payment Required - {\"error\":{\"code\":\"INSUFFICIENT_CREDITS\",\"message\":\"Insufficient credits: balance=4, required=5\"}}";
    assert!(
        tsp::is_insufficient_credits_failure(reason),
        "exact provider 402 insufficient-credits reason must be classified"
    );
    assert!(
        !tsp::should_restart_on_error_event(reason),
        "credits exhaustion must not restart the automaton"
    );
    assert!(
        !tsp::classify_failure(reason).is_retryable(),
        "credits exhaustion must classify as a non-retryable HarnessFailureKind"
    );
}

#[test]
fn insufficient_credits_classifier_covers_api_code_forms() {
    for reason in [
        "upstream returned payment_required",
        "body code=insufficient_credits",
        "402 Payment Required",
        "Insufficient credits: balance=0",
    ] {
        assert!(
            tsp::is_insufficient_credits_failure(reason),
            "credits classifier missed '{reason}'"
        );
    }
}

#[test]
fn task_done_no_file_reason_is_completion_contract_not_truncation() {
    let reason = "ERROR: You are completing this task but have not made any file changes \
                  (write_file, edit_file, or delete_file). Implementation tasks must produce \
                  file changes. If this task genuinely requires no file changes, call \
                  task_done again with \"no_changes_needed\": true and explain why in the \
                  notes field.";

    assert!(
        tsp::is_completion_contract_failure(reason),
        "task_done no-file failures should be labeled as completion-contract errors"
    );
    assert!(
        !tsp::is_truncation_failure(reason),
        "task_done no-file failures must not trigger truncation decomposition"
    );
}

#[test]
fn completion_contract_failure_retries_before_budget_exhaustion() {
    let decision = tsp::reconcile_decision(&[], "completion_contract", 0, 3, false, false);

    assert_eq!(
        decision,
        json!({
            "action": "retry_task",
        }),
        "missing file-edit evidence should get a fresh task attempt before becoming terminal"
    );
}

#[test]
fn research_loop_abort_verdict_is_restartable_at_classifier_layer() {
    // Verbatim verdict aura-harness emits from its post-hoc
    // `validate_execution` gate when the agent stayed in research
    // mode and never produced a file operation. The em dash is
    // U+2014 — paste verbatim, do not substitute an ASCII hyphen.
    let reason = "agent execution error: task completed without any file operations — \
                  completion not verified";
    assert!(
        tsp::should_restart_on_error_event(reason),
        "research-loop abort verdict must be classified as a \
         restartable transient so the task-level retry path can \
         schedule a fresh-context retry instead of leaving the \
         task permanently Failed",
    );
    assert_eq!(
        tsp::classify_failure(reason),
        aura_os_harness::signals::HarnessFailureKind::ResearchLoopAbort,
        "and the same verdict must classify as the typed \
         ResearchLoopAbort variant so the reconciler decision \
         table can branch on it directly",
    );
}