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

#[test]
fn completion_gate_accepts_harness_terminal_state_despite_empty_path_write_history() {
    // Empty-path writes remain useful diagnostic history, but the harness
    // owns whether the task is complete. aura-os must not reject a harness
    // terminal event based on its own DoD interpretation.
    let reason = tsp::completion_validation_reason_with_empty_path_writes(
        "never wrote anything real",
        /* files_changed */ &[],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 1,
        /* clippy */ 1,
        /* empty-path writes */ 1,
    );
    assert!(
        reason.is_none(),
        "aura-os must defer completion semantics to the harness, got rejection: {reason:?}"
    );
}

#[test]
fn completion_gate_accepts_empty_path_write_when_recovered() {
    // Task 2.4 regression: the automaton emitted a handful of
    // empty-path write_file calls, the harness surfaced the error
    // inline, and the automaton recovered with a real-path write
    // that did land on disk. The history is display-only in aura-os;
    // the harness determines whether the recovery satisfied DoD.
    let reason = tsp::completion_validation_reason_with_empty_path_writes(
        "implementation complete after a misfire",
        &["crates/zero-program/src/lib.rs"],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 1,
        /* clippy */ 1,
        /* empty-path writes */ 3,
    );
    assert!(
        reason.is_none(),
        "aura-os must not fail recovered empty-path history, got rejection: {reason:?}"
    );
}

#[test]
fn completion_gate_accepts_fully_evidenced_run_with_no_empty_path_writes() {
    let reason = tsp::completion_validation_reason_with_empty_path_writes(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        1,
        1,
        1,
        1,
        0,
    );
    assert!(
        reason.is_none(),
        "a fully-evidenced run must pass the gate, got rejection: {reason:?}"
    );
}

/// Regression for task `2.1 Secret wrappers: NeuralKey, ShamirShare,
/// Secret<T>`, which failed on 2026-04-23 with the reason
/// "Automaton emitted write_file/edit_file tool call(s) with an empty
/// or missing \"path\" input; the harness must retry with a real
/// path before task_done".
#[test]
fn task_21_empty_path_misfire_then_retry_passes_the_gate() {
    let events = vec![
        (
            "tool_call_started".to_string(),
            json!({
                "id": "w1",
                "name": "write_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "w1",
                "name": "write_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_started".to_string(),
            json!({
                "id": "w2",
                "name": "write_file",
                "input": { "path": "crates/zero-identity/src/secret.rs" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "w2",
                "name": "write_file",
                "input": { "path": "crates/zero-identity/src/secret.rs" },
            }),
        ),
        (
            "tool_call_started".to_string(),
            json!({
                "id": "e1",
                "name": "edit_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "e1",
                "name": "edit_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_started".to_string(),
            json!({
                "id": "e2",
                "name": "edit_file",
                "input": { "path": "crates/zero-identity/src/types.rs" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "e2",
                "name": "edit_file",
                "input": { "path": "crates/zero-identity/src/types.rs" },
            }),
        ),
    ];
    let reason = tsp::replay_task_completion_gate(
        &events,
        "implementation complete",
        &[
            "crates/zero-identity/src/secret.rs",
            "crates/zero-identity/src/types.rs",
        ],
        1,
        1,
        1,
        1,
    );
    assert!(
        reason.is_none(),
        "reconciled empty-path misfires must not fail the gate, got rejection: {reason:?}"
    );
}

#[test]
fn empty_path_misfire_without_recovery_defers_to_harness_dod() {
    // Pre-existing test, updated to reflect the harness-owns-DoD
    // design (`completion_validation_failure_reason_with_empty_path_writes_for_tests`
    // is intentionally inert — see the docstring on that function in
    // `dev_loop/signals.rs`). aura-os keeps empty-path-write history
    // for diagnostic display only; the harness decides whether the
    // run satisfied DoD. The matching positive case lives at
    // `completion_gate_accepts_harness_terminal_state_despite_empty_path_write_history`.
    let events = vec![
        (
            "tool_call_started".to_string(),
            json!({
                "id": "w1",
                "name": "write_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "w1",
                "name": "write_file",
                "input": { "path": "" },
            }),
        ),
    ];
    let reason = tsp::replay_task_completion_gate(
        &events,
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        1,
        1,
        1,
        1,
    );
    assert!(
        reason.is_none(),
        "aura-os defers DoD to the harness; an unreconciled empty-path write \
         is diagnostic history, not a DoD-blocking failure. Got rejection: \
         {reason:?}"
    );
}

#[test]
fn completion_gate_accepts_source_edit_without_local_verification_evidence() {
    let reason = tsp::completion_validation_reason(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        0,
        0,
        0,
        0,
    );
    assert!(
        reason.is_none(),
        "aura-os must not reject source edits based on local verification counters"
    );
}

// ---------------------------------------------------------------------------
// Tests-as-truth completion gate
//
// Regression for task `4.4 Deterministic CBOR AAD builder` (run id
// 9995d958-c193-4998-b5d3-d5b9f4092a45), which failed with
// "agent execution error: task completed without any file operations —
// completion not verified" even though the implementation already
// existed and was covered by tests in `crates/zero-crypto`.
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
        "`cargo test --no-run` compiles tests but does not run them — must not gate completion"
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
    // Harness verdict says CompletionContract; without evidence we mark
    // the task terminal as "completion_contract".
    let without_evidence = tsp::reconcile_decision_with_test_evidence(
        &[],
        "completion_contract",
        0,
        3,
        false,
        false,
        /* has_test_pass_evidence */ false,
    );
    assert_eq!(
        without_evidence,
        json!({
            "action": "mark_terminal",
            "reason": "completion_contract",
        }),
        "no test evidence: keep harness verdict as a terminal completion-contract failure"
    );

    // With evidence we override into a successful no-edit completion.
    let with_evidence = tsp::reconcile_decision_with_test_evidence(
        &[],
        "completion_contract",
        0,
        3,
        false,
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
// Research-loop abort verdict (aura-harness post-hoc completion gate)
// ---------------------------------------------------------------------------
//
// When the agent stays in research mode and never produces a file
// operation, the harness's `validate_execution` emits the verbatim
// reason below. The server classifier must recognise it as a
// CompletionContract failure so the task-level retry path can route
// it to a fresh-context attempt instead of marking the task
// permanently Failed.

#[test]
fn research_loop_abort_verdict_is_completion_contract_failure() {
    // Verbatim verdict from aura-harness's post-hoc completion
    // gate. The em dash is U+2014 — paste verbatim, do not
    // substitute an ASCII hyphen.
    let reason = "agent execution error: task completed without any file operations — \
                  completion not verified";
    assert!(
        tsp::is_completion_contract_failure(reason),
        "research-loop abort verdict must classify as a \
         CompletionContract failure so the dev-loop retry path \
         routes it to a fresh-context retry instead of marking \
         the task permanently Failed",
    );
}

// ---------------------------------------------------------------------------
// Workspace-health diff gate (Phase 4 of workspace-health-diff-gate)
//
// Tests the 8-row verdict matrix from
// c:\Users\n3o\.cursor\plans\workspace-health-diff-gate_1121eaf1.plan.md.
// Each test pins one matrix row by constructing a baseline + current
// WorkspaceHealth, a TaskScope, a TaskKind, and (where relevant) a
// strict-mode flag, then asserts the gate's verdict.
// ---------------------------------------------------------------------------

use tsp::automation::{
    classify_delta, extract_task_scope, HealthError, TaskKind, WorkspaceHealth,
};

fn health_error(file: &str, code: &str, kind: &str) -> HealthError {
    HealthError {
        file: file.to_owned(),
        code: Some(code.to_owned()),
        kind: kind.to_owned(),
    }
}

/// Reproduces the red baseline from the prior chat's Task 3.7 /
/// Task 3.9 failure mode (cargo check --workspace --tests red in
/// crates/zero-storage). Used as both the in-flight nudge replay
/// baseline and the persistent-red gate replay baseline.
fn red_baseline_from_prior_chat() -> WorkspaceHealth {
    WorkspaceHealth::failing(vec![
        health_error(
            "crates/zero-storage/src/types.rs",
            "E0277",
            "trait bound `[u8; 64]: Serialize` not satisfied",
        ),
        health_error(
            "crates/zero-storage/src/types.rs",
            "E0277",
            "trait bound `[u8; 64]: Deserialize<'_>` not satisfied",
        ),
        health_error(
            "crates/zero-storage/src/types.rs",
            "E0432",
            "unresolved import `zero_identity`",
        ),
        health_error(
            "crates/zero-storage/src/types.rs",
            "E0425",
            "cannot find value `zero_identity` in this scope",
        ),
    ])
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
    // Baseline is clean; current introduces a brand-new error =>
    // matrix row 1 (`workspace_health_regressed`, blocks).
    let baseline = WorkspaceHealth::clean();
    let current = WorkspaceHealth::failing(vec![health_error(
        "crates/zero-network/src/lib.rs",
        "E0277",
        "trait bound not satisfied",
    )]);
    let scope = extract_task_scope(
        "Tighten the wire-encoding helpers in crates/zero-network/src/lib.rs",
        &[],
    );
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
        &scope,
        TaskKind::Implementation,
        /* strict_mode */ false,
    );
    assert_eq!(
        reason,
        Some("workspace_health_regressed"),
        "a brand-new error must reject task_done with the regressed verdict",
    );
}

#[test]
fn workspace_health_unfixed_in_scope_rejects_when_task_names_failing_crate() {
    // Baseline and current both red on the same file. The task
    // claims to touch the crate that's red => matrix row 2
    // (`workspace_health_unfixed_in_scope`, blocks).
    let baseline = red_baseline_from_prior_chat();
    let current = baseline.clone();
    let scope = extract_task_scope(
        "Fix the failing serde derives in crates/zero-storage so cargo check --workspace --tests \
         is green again.",
        &[],
    );
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
        &scope,
        TaskKind::Implementation,
        false,
    );
    assert_eq!(
        reason,
        Some("workspace_health_unfixed_in_scope"),
        "claiming to touch crates/zero-storage but leaving its errors must reject task_done",
    );
}

#[test]
fn workspace_health_red_blocking_implementation_rejects_code_task_in_red_workspace() {
    // Baseline red in zero-storage; the task is an Implementation
    // task targeting a different crate => matrix row 3
    // (`workspace_health_red_blocking_implementation`, blocks).
    let baseline = red_baseline_from_prior_chat();
    let current = baseline.clone();
    let scope = extract_task_scope(
        "Add a new public helper to crates/aura-os-automation/src/budget/exploration.rs.",
        &[],
    );
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
        &scope,
        TaskKind::Implementation,
        false,
    );
    assert_eq!(
        reason,
        Some("workspace_health_red_blocking_implementation"),
        "an Implementation task in a red workspace must block even when scope misses the red",
    );
}

#[test]
fn workspace_health_unchanged_advisory_accepts_doc_task_in_red_workspace_permissive_mode() {
    // Baseline red in zero-storage; the task is a doc-only README
    // edit with strict mode OFF => matrix row 4
    // (`workspace_health_unchanged_advisory`, does NOT block).
    let baseline = red_baseline_from_prior_chat();
    let current = baseline.clone();
    let scope = extract_task_scope(
        "Write the new docs/architecture/grid-conformance.md walkthrough; no Rust changes.",
        &[],
    );
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
        &scope,
        TaskKind::Documentation,
        /* strict_mode */ false,
    );
    assert_eq!(
        reason, None,
        "a documentation task whose scope does not intersect the red MUST accept task_done in \
         permissive mode; the gate surfaces the advisory through a different path",
    );
}

#[test]
fn workspace_health_red_blocked_by_strict_mode_rejects_doc_task_when_knob_on() {
    // Same inputs as the permissive doc-task test above, but with
    // strict mode ON => matrix row 5
    // (`workspace_health_red_blocked_by_strict_mode`, blocks).
    let baseline = red_baseline_from_prior_chat();
    let current = baseline.clone();
    let scope = extract_task_scope(
        "Write the new docs/architecture/grid-conformance.md walkthrough; no Rust changes.",
        &[],
    );
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &task_done_event(),
        Some(&baseline),
        Some(&current),
        &scope,
        TaskKind::Documentation,
        /* strict_mode */ true,
    );
    assert_eq!(
        reason,
        Some("workspace_health_red_blocked_by_strict_mode"),
        "doc task in red workspace under strict mode must reject task_done; this is the \
         operator-opt-in policy that catches the prior chat's Task 3.9 failure",
    );
}

#[test]
fn workspace_health_improved_always_accepts() {
    // Baseline red, current clean => matrix row 6
    // (`workspace_health_improved`, does NOT block). Pin the
    // accept regardless of strict mode and task kind.
    let baseline = red_baseline_from_prior_chat();
    let current = WorkspaceHealth::clean();
    let scope = extract_task_scope("Fix the workspace red surface.", &[]);
    for strict in [false, true] {
        for kind in [
            TaskKind::Implementation,
            TaskKind::Documentation,
            TaskKind::Refactor,
            TaskKind::Verification,
            TaskKind::Unknown,
        ] {
            let reason = tsp::task_done_workspace_health_gate_reason(
                "tool_call_completed",
                &task_done_event(),
                Some(&baseline),
                Some(&current),
                &scope,
                kind,
                strict,
            );
            assert_eq!(
                reason, None,
                "improved workspace must accept task_done for kind={kind:?} strict={strict}",
            );
        }
    }
}

#[test]
fn workspace_health_clean_baseline_clean_current_accepts() {
    // Both baseline and current clean => matrix row 7
    // (`workspace_health_clean`, does NOT block) regardless of
    // task kind / strict mode.
    let baseline = WorkspaceHealth::clean();
    let current = WorkspaceHealth::clean();
    let scope = extract_task_scope("Touch crates/zero-program/src/lib.rs.", &[]);
    for strict in [false, true] {
        for kind in [
            TaskKind::Implementation,
            TaskKind::Documentation,
            TaskKind::Refactor,
            TaskKind::Verification,
            TaskKind::Unknown,
        ] {
            let reason = tsp::task_done_workspace_health_gate_reason(
                "tool_call_completed",
                &task_done_event(),
                Some(&baseline),
                Some(&current),
                &scope,
                kind,
                strict,
            );
            assert_eq!(
                reason, None,
                "clean->clean must accept task_done for kind={kind:?} strict={strict}",
            );
        }
    }
}

#[test]
fn workspace_health_unknown_baseline_falls_back_to_current_gate() {
    // No baseline => matrix row 8
    // (`workspace_health_unknown_baseline`, does NOT block). The
    // gate returns `None` so the existing
    // `task_done_missing_file_changes_reason` continues to own the
    // decision — verified here by also pinning that existing gate's
    // verdict on the same event.
    let scope = extract_task_scope(
        "Add a snapshot helper to crates/aura-os-automation/src/health/snapshot.rs.",
        &[],
    );
    let event = task_done_event();
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &event,
        /* baseline */ None,
        /* current */ None,
        &scope,
        TaskKind::Implementation,
        /* strict_mode */ true,
    );
    assert_eq!(
        reason, None,
        "absent baseline must defer to the pre-existing completion gate (back-compat)",
    );
    // Cross-check: the existing file-evidence gate is unaffected by
    // the new gate's None return, so a no-file-changes task_done
    // still fails through the legacy path. This proves the new gate
    // is purely additive on the unknown-baseline path.
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &event, &[]),
        Some("task_done_without_file_changes"),
        "legacy gate must continue to reject no-file-changes task_done when baseline is absent",
    );
}

// ---------------------------------------------------------------------------
// Replay assertions against the prior-chat failure modes
//
// These pin the specific failure shapes the prior chat hit (Tasks 3.7,
// 3.9-strict, 3.9-permissive) so any regression in the gate would
// reopen the original bugs.
// ---------------------------------------------------------------------------

#[test]
fn replay_task_37_subscriber_pump_advisory_targets_storage_crate() {
    // Prior chat's Task 3.7 ran out of exploration budget without
    // producing any file ops. The fix (Phase 2 of the plan) is the
    // health-aware advisory header: when the baseline is red, the
    // header must name the broken crate so the agent has a
    // concrete target from turn 1. This test replays the 3.7
    // baseline shape and pins that the advisory mentions
    // `zero-storage` somewhere in its text.
    let baseline = red_baseline_from_prior_chat();
    let scope = extract_task_scope(
        "Implement the subscriber pump in crates/zero-network.",
        &[],
    );
    let budget = tsp::automation::ExplorationBudget::for_task(/* description_len */ 0, /* dependency_count */ 0);
    let advisory = budget.advisory_text_with_health_no_cache(
        /* used */ 0,
        Some(&baseline),
        Some(&scope),
    );
    let advisory = advisory.expect("baseline red MUST surface an advisory even on turn 1");
    assert!(
        advisory.contains("zero-storage"),
        "advisory must name the broken crate so the agent has a concrete target; got: {advisory}",
    );
}

#[test]
fn replay_task_39_strict_mode_rejects_doc_task_with_persistent_red() {
    // Prior chat's Task 3.9: the agent edited a README.md while
    // `cargo check --workspace --tests` was red in zero-storage,
    // and the old gate accepted task_done. Under the new strict
    // policy (operator opt-in via AURA_BLOCK_TASK_DONE_ON_ANY_WORKSPACE_RED),
    // the same shape must reject with the strict-mode verdict.
    let baseline = red_baseline_from_prior_chat();
    let current = baseline.clone();
    // The 3.9 task's description was about GRID conformance docs;
    // its scope deliberately did not intersect zero-storage.
    let scope = extract_task_scope(
        "Author the GRID conformance walkthrough in docs/architecture/grid-conformance.md.",
        &[],
    );
    // README-only task_done event.
    let event = json!({
        "name": "task_done",
        "input": {
            "notes": "Conformance walkthrough written; no Rust changes required."
        }
    });
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &event,
        Some(&baseline),
        Some(&current),
        &scope,
        TaskKind::Documentation,
        /* strict_mode */ true,
    );
    assert_eq!(
        reason,
        Some("workspace_health_red_blocked_by_strict_mode"),
        "strict-mode replay of Task 3.9 must reject the doc-only task_done so the dev-loop \
         routes it through a fresh-context retry that surfaces the red zero-storage area",
    );
}

#[test]
fn replay_task_39_permissive_mode_accepts_doc_task_with_persistent_red_but_surfaces_advisory() {
    // Same inputs as the strict-mode replay, but with strict OFF.
    // The gate must accept task_done (back-compat default) AND
    // classify the underlying delta as `workspace_health_unchanged_advisory`
    // so the followup-emission path has a hook to spawn a "fix
    // zero-storage red" task next.
    let baseline = red_baseline_from_prior_chat();
    let current = baseline.clone();
    let scope = extract_task_scope(
        "Author the GRID conformance walkthrough in docs/architecture/grid-conformance.md.",
        &[],
    );
    let event = json!({
        "name": "task_done",
        "input": {
            "notes": "Conformance walkthrough written; no Rust changes required."
        }
    });
    let reason = tsp::task_done_workspace_health_gate_reason(
        "tool_call_completed",
        &event,
        Some(&baseline),
        Some(&current),
        &scope,
        TaskKind::Documentation,
        /* strict_mode */ false,
    );
    assert_eq!(
        reason, None,
        "permissive-mode replay of Task 3.9 must accept the doc-only task_done so the existing \
         dev-loop behaviour is unchanged by default",
    );
    // The followup-emission path keys off the advisory reason; pin
    // it here so a verdict-matrix change can't silently break the
    // follow-up task scaffolding (Phase 4b/5).
    let delta = classify_delta(
        &baseline,
        &current,
        &scope,
        TaskKind::Documentation,
        /* strict_mode */ false,
    );
    assert_eq!(
        delta.reason, "workspace_health_unchanged_advisory",
        "permissive-mode delta must classify as the advisory verdict so the follow-up emission \
         path can spawn a remediation task without re-running the classifier",
    );
    assert!(
        delta.advisory_summary.is_some(),
        "advisory verdict must carry a human-readable summary so prompt headers can name the red \
         area; got: {delta:?}",
    );
}
