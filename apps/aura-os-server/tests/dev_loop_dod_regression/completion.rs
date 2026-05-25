//! `task_done` no-change contract and the completion gate.

use aura_os_server::phase7_test_support as tsp;
use serde_json::json;

#[test]
fn task_done_accepts_explicit_no_changes_needed_without_file_evidence() {
    let ev = json!({
        "name": "task_done",
        "input": {
            "no_changes_needed": true,
            "notes": "The requested implementation was already present and covered by tests."
        }
    });

    assert!(tsp::task_done_declares_no_changes_needed(
        "tool_call_completed",
        &ev
    ));
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &ev, &[]),
        None,
        "explicit no_changes_needed is the required success path for already-complete implementation tasks"
    );
}

#[test]
fn task_done_requires_file_evidence_when_no_changes_needed_is_absent() {
    let ev = json!({
        "name": "task_done",
        "input": {
            "notes": "Implementation complete"
        }
    });

    assert!(!tsp::task_done_declares_no_changes_needed(
        "tool_call_completed",
        &ev
    ));
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &ev, &[]),
        Some("task_done_without_file_changes"),
        "implementation completions still require write/edit/delete evidence unless they opt into no_changes_needed"
    );
}

#[test]
fn task_done_with_file_evidence_does_not_need_no_changes_flag() {
    let ev = json!({
        "name": "task_done",
        "input": {
            "notes": "Implementation complete"
        }
    });

    assert_eq!(
        tsp::task_done_missing_file_changes_reason(
            "tool_call_completed",
            &ev,
            &["crates/zero-network/src/program.rs"]
        ),
        None
    );
}

#[test]
fn task_done_no_change_contract_ignores_errored_or_unrelated_events() {
    let errored = json!({
        "name": "task_done",
        "is_error": true,
        "input": { "no_changes_needed": true }
    });
    assert!(!tsp::task_done_declares_no_changes_needed(
        "tool_call_completed",
        &errored
    ));
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &errored, &[]),
        None
    );

    let unrelated = json!({
        "name": "run_command",
        "input": { "cmd": "cargo test" }
    });
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &unrelated, &[]),
        None
    );
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_started", &unrelated, &[]),
        None
    );
}

// ---------------------------------------------------------------------------
// Tests-as-truth completion gate
//
// The fix introduces a third valid completion path next to file-edit
// evidence and explicit `no_changes_needed: true`: a successful
// invocation of a recognized test runner (cargo test / pnpm vitest /
// pytest / ...) accumulated during the run is itself accepted as
// completion evidence. The reconciler then bridges the harness
// `CompletionContract` failure into a `mark_done` action with reason
// `test_evidence_accepted` rather than a terminal failure.
// ---------------------------------------------------------------------------

#[test]
fn test_runner_detector_accepts_canonical_passing_invocations() {
    for cmd in [
        "cargo test -p zero-crypto",
        "cargo nextest run --workspace",
        "pnpm vitest run",
        "pnpm jest --runInBand",
        "pytest -xvs tests/",
        "python -m pytest -q",
        "go test ./...",
        "mix test",
        "bun test",
        "yarn test",
        "pnpm test",
        "npm test --silent",
    ] {
        let event = json!({
            "name": "run_command",
            "input": { "command": cmd },
            "output": { "exit_code": 0 },
        });
        assert!(
            tsp::is_successful_test_run_event("tool_call_completed", &event),
            "{cmd}: must register as test-pass evidence"
        );
        assert!(
            tsp::recognized_test_runner_label(cmd).is_some(),
            "{cmd}: must produce a stable runner label"
        );
    }
}

#[test]
fn test_runner_detector_rejects_build_only_and_failing_runs() {
    let no_run = json!({
        "name": "run_command",
        "input": { "command": "cargo test --no-run" },
        "output": { "exit_code": 0 },
    });
    assert!(
        !tsp::is_successful_test_run_event("tool_call_completed", &no_run),
        "`cargo test --no-run` compiles tests but does not run them â€” must not gate completion"
    );

    let cargo_check = json!({
        "name": "run_command",
        "input": { "command": "cargo check --workspace" },
        "output": { "exit_code": 0 },
    });
    assert!(
        !tsp::is_successful_test_run_event("tool_call_completed", &cargo_check),
        "type-check-only commands must not gate completion"
    );

    let failing = json!({
        "name": "run_command",
        "input": { "command": "cargo test" },
        "output": { "exit_code": 101 },
    });
    assert!(
        !tsp::is_successful_test_run_event("tool_call_completed", &failing),
        "non-zero exit must disqualify the evidence"
    );

    let errored = json!({
        "name": "run_command",
        "is_error": true,
        "input": { "command": "cargo test" },
        "output": { "exit_code": 0 },
    });
    assert!(
        !tsp::is_successful_test_run_event("tool_call_completed", &errored),
        "tool-call error flag must disqualify the evidence even if exit_code is 0"
    );
}

#[test]
fn test_runner_detector_ignores_non_shell_tool_calls() {
    // `write_file` adapters occasionally carry a synthetic `command`
    // string in their input; the gate must ignore them so we don't
    // accidentally accept "wrote a file with the word `cargo test` in
    // it" as a passing test run.
    let write = json!({
        "name": "write_file",
        "input": { "command": "cargo test", "path": "src/lib.rs" },
        "output": { "exit_code": 0 },
    });
    assert!(!tsp::is_successful_test_run_event(
        "tool_call_completed",
        &write
    ));
}

#[test]
fn reconciler_overrides_completion_contract_when_test_evidence_present() {
    // Harness verdict says CompletionContract; without evidence we retry
    // while budget remains.
    let without_evidence = tsp::reconcile_decision_with_test_evidence(
        &[],
        "completion_contract",
        0,
        3,
        false,
        /* has_test_pass_evidence */ false,
    );
    assert_eq!(
        without_evidence,
        json!({
            "action": "retry_task",
        }),
        "no test evidence: retry completion-contract failures while budget remains"
    );

    // With evidence we override into a successful no-edit completion.
    let with_evidence = tsp::reconcile_decision_with_test_evidence(
        &[],
        "completion_contract",
        0,
        3,
        false,
        /* has_test_pass_evidence */ true,
    );
    assert_eq!(
        with_evidence,
        json!({
            "action": "mark_done",
            "reason": "test_evidence_accepted",
        }),
        "test-pass evidence must override CompletionContract into a Done transition"
    );
}

#[test]
fn reconciler_marks_completion_contract_terminal_after_retry_budget_exhaustion() {
    let exhausted = tsp::reconcile_decision_with_test_evidence(
        &[],
        "completion_contract",
        3,
        3,
        false,
        /* has_test_pass_evidence */ false,
    );

    assert_eq!(
        exhausted,
        json!({
            "action": "mark_terminal",
            "reason": "completion_contract",
        }),
        "completion-contract failures should become terminal only after retry budget is exhausted"
    );
}

#[test]
fn reconciler_does_not_override_other_failure_classes_with_test_evidence() {
    // Test-pass evidence is specifically for the "no file edits"
    // contract failure. It must not paper over other failure classes.
    for class in ["truncation", "rate_limited", "push_timeout", "other"] {
        let decision = tsp::reconcile_decision_with_test_evidence(
            &[],
            class,
            0,
            3,
            false,
            /* has_test_pass_evidence */ true,
        );
        let action = decision
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert_ne!(
            action, "mark_done",
            "{class}: test-pass evidence must not override non-completion-contract failures"
        );
    }
}

// ---------------------------------------------------------------------------
// Workspace-health diff gate (single-rule)
//
// Pins the simplified gate: errors-up or tests-regressed demote
// `task_done`, every other diff lets it through.
// ---------------------------------------------------------------------------

use tsp::automation::{classify_delta, HealthError, WorkspaceHealth};

fn health_error(file: &str, code: &str, kind: &str) -> HealthError {
    HealthError {
        file: file.to_owned(),
        code: Some(code.to_owned()),
        kind: kind.to_owned(),
    }
}

fn task_done_event() -> serde_json::Value {
    json!({
        "name": "task_done",
        "input": {
            "notes": "Implementation complete."
        }
    })
}

#[test]
fn workspace_health_regression_rejects_task_done() {
    // Baseline is clean; current introduces a brand-new error.
    let baseline = WorkspaceHealth::clean();
    let current = WorkspaceHealth::failing(vec![health_error(
        "crates/zero-network/src/lib.rs",
        "E0277",
        "trait bound not satisfied",
    )]);
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
    );
    assert_eq!(
        reason,
        Some("workspace_health_regressed"),
        "a brand-new error must reject task_done with the regressed verdict",
    );
}

#[test]
fn workspace_health_unchanged_red_does_not_block_task_done() {
    // Baseline and current both red on the same files. With the
    // simplified gate (errors-up only), unchanged red lets
    // task_done through.
    let baseline = WorkspaceHealth::failing(vec![health_error(
        "crates/zero-storage/src/types.rs",
        "E0277",
        "trait bound",
    )]);
    let current = baseline.clone();
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
    );
    assert_eq!(
        reason, None,
        "unchanged red baseline must NOT block task_done under the simplified single-rule gate",
    );
}

#[test]
fn workspace_health_improved_always_accepts() {
    // Baseline red, current clean. The diff classifies as Improved
    // and must not block.
    let baseline = WorkspaceHealth::failing(vec![health_error(
        "crates/zero-storage/src/types.rs",
        "E0277",
        "trait bound",
    )]);
    let current = WorkspaceHealth::clean();
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
    );
    assert_eq!(reason, None, "improved workspace must accept task_done");
}

#[test]
fn workspace_health_clean_baseline_clean_current_accepts() {
    let baseline = WorkspaceHealth::clean();
    let current = WorkspaceHealth::clean();
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
    );
    assert_eq!(reason, None, "clean->clean must accept task_done");
}

#[test]
fn workspace_health_unknown_baseline_falls_back_to_current_gate() {
    // No baseline: the gate returns `None` so the existing
    // `task_done_missing_file_changes_reason` continues to own the
    // decision.
    let event = task_done_event();
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &event,
        /* baseline */ None,
        /* current */ None,
    );
    assert_eq!(
        reason, None,
        "absent baseline must defer to the pre-existing completion gate (back-compat)",
    );
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &event, &[]),
        Some("task_done_without_file_changes"),
        "legacy gate must continue to reject no-file-changes task_done when baseline is absent",
    );
}

#[test]
fn classify_delta_regressed_carries_simplified_reason() {
    let baseline = WorkspaceHealth::clean();
    let current = WorkspaceHealth::failing(vec![health_error(
        "crates/zero-storage/src/types.rs",
        "E0277",
        "trait bound",
    )]);
    let delta = classify_delta(&baseline, &current);
    assert_eq!(delta.reason, "workspace_health_regressed");
    assert!(delta.verdict.blocks_task_done());
    assert!(
        delta.advisory_summary.is_some(),
        "regressed verdict must carry a human-readable summary"
    );
}
