//! 8-row verdict matrix for the workspace-health diff gate.
//!
//! Phase 1 of `workspace-health-diff-gate`. Pure function — takes two
//! `WorkspaceHealth` snapshots plus the task's scope / kind / strict-
//! mode flag and returns a [`HealthDelta`]. No I/O, no async, no
//! storage access; the App layer is responsible for collecting the
//! inputs and acting on the verdict.
//!
//! The matrix below is reproduced from the plan word-for-word:
//!
//! | Baseline | Current | Scope hits red? | Kind | Strict | Verdict |
//! |----------|---------|-----------------|------|--------|---------|
//! | any | regressed | — | any | — | `workspace_health_regressed` |
//! | failing | unchanged | yes | any | — | `workspace_health_unfixed_in_scope` |
//! | failing | unchanged | no | implementation | — | `workspace_health_red_blocking_implementation` |
//! | failing | unchanged | no | doc/refactor/verify | off | `workspace_health_unchanged_advisory` |
//! | failing | unchanged | no | doc/refactor/verify | on | `workspace_health_red_blocked_by_strict_mode` |
//! | failing | improved/clean | — | any | — | `workspace_health_improved` |
//! | clean | clean | — | any | — | `workspace_health_clean` |
//! | absent | any | — | any | — | `workspace_health_unknown_baseline` |
//!
//! [`HealthVerdict::blocks_task_done`] returns true ONLY for the
//! `Regressed`, `UnfixedInScope`, `RedBlockingImplementation`, and
//! `RedBlockedByStrictMode` rows.

use std::collections::BTreeMap;

use crate::health::task_scope::TaskScope;
use crate::health::types::{
    BuildStatus, HealthDelta, HealthError, HealthVerdict, TaskKind, WorkspaceHealth,
};

/// Reason string for [`HealthVerdict::Improved`].
pub const REASON_IMPROVED: &str = "workspace_health_improved";
/// Reason string for [`HealthVerdict::Clean`].
pub const REASON_CLEAN: &str = "workspace_health_clean";
/// Reason string for [`HealthVerdict::UnchangedAdvisory`].
pub const REASON_UNCHANGED_ADVISORY: &str = "workspace_health_unchanged_advisory";
/// Reason string for [`HealthVerdict::Regressed`].
pub const REASON_REGRESSED: &str = "workspace_health_regressed";
/// Reason string for [`HealthVerdict::UnfixedInScope`].
pub const REASON_UNFIXED_IN_SCOPE: &str = "workspace_health_unfixed_in_scope";
/// Reason string for [`HealthVerdict::RedBlockingImplementation`].
pub const REASON_RED_BLOCKING_IMPL: &str = "workspace_health_red_blocking_implementation";
/// Reason string for [`HealthVerdict::RedBlockedByStrictMode`].
pub const REASON_RED_BLOCKED_BY_STRICT: &str = "workspace_health_red_blocked_by_strict_mode";
/// Reason string for [`HealthVerdict::UnknownBaseline`].
pub const REASON_UNKNOWN_BASELINE: &str = "workspace_health_unknown_baseline";

/// The four `workspace_health_*` reason strings that block
/// `task_done` (i.e. the ones for which
/// [`HealthVerdict::blocks_task_done`] returns `true`).
///
/// Kept as a `const` so the App layer and the cross-crate
/// `aura-os-harness` predicate can iterate the same set without
/// re-typing the literals. The non-blocking advisory reasons
/// (`workspace_health_improved`, `_clean`, `_unchanged_advisory`,
/// `_unknown_baseline`) deliberately do NOT appear here — they
/// don't gate completion.
pub const WORKSPACE_HEALTH_BLOCKING_REASONS: &[&str] = &[
    REASON_REGRESSED,
    REASON_UNFIXED_IN_SCOPE,
    REASON_RED_BLOCKING_IMPL,
    REASON_RED_BLOCKED_BY_STRICT,
];

/// True when `reason` is *exactly* one of the four workspace-health
/// verdict reason strings that block `task_done`. The non-blocking
/// advisory reasons (`workspace_health_improved`, `_clean`,
/// `_unchanged_advisory`, `_unknown_baseline`) deliberately do
/// NOT match.
///
/// Use this when you have the bare reason in hand (e.g. straight off
/// [`HealthDelta::reason`]). When the reason may be embedded in a
/// larger error message (e.g. the harness's `task_failed` text),
/// use [`contains_workspace_health_blocking_reason`] instead.
#[must_use]
pub fn is_workspace_health_blocking_reason(reason: &str) -> bool {
    matches!(
        reason,
        REASON_REGRESSED
            | REASON_UNFIXED_IN_SCOPE
            | REASON_RED_BLOCKING_IMPL
            | REASON_RED_BLOCKED_BY_STRICT
    )
}

/// True when `reason` (case-insensitively) contains any of the four
/// workspace-health blocking reason substrings.
///
/// Used by the cross-layer completion-contract classifier so the
/// `is_completion_contract_failure` path matches whether the reason
/// arrives bare (`workspace_health_regressed`) or wrapped in a
/// larger error message (`"agent execution error:
/// workspace_health_regressed at task_done"`). The advisory-only
/// reasons (`_improved`, `_clean`, `_unchanged_advisory`,
/// `_unknown_baseline`) deliberately do NOT match.
#[must_use]
pub fn contains_workspace_health_blocking_reason(reason: &str) -> bool {
    let lower = reason.to_ascii_lowercase();
    WORKSPACE_HEALTH_BLOCKING_REASONS
        .iter()
        .any(|needle| lower.contains(needle))
}

impl HealthDelta {
    /// Constructor for the no-baseline fallback path. Lives next to
    /// [`classify_delta`] because the reason string is a private const
    /// of the `delta` module.
    #[must_use]
    pub fn unknown_baseline() -> Self {
        Self {
            verdict: HealthVerdict::UnknownBaseline,
            reason: REASON_UNKNOWN_BASELINE,
            advisory_summary: None,
        }
    }
}

/// Classify the difference between `baseline` and `current`.
///
/// Pure: no I/O, no env reads (`strict` is passed in explicitly so
/// tests stay hermetic), no global state.
///
/// Argument convention:
///
/// * `scope` is the [`TaskScope`] the task claimed when it was
///   submitted. Use [`TaskScope::default()`] for "the task didn't
///   claim any particular area".
/// * `kind` is the classified [`TaskKind`]. `Unknown` is treated as
///   `Implementation` for safety (the safe default blocks red
///   workspaces).
/// * `strict` is the resolved value of
///   [`super::strict_mode::is_strict_mode_enabled`]. The caller
///   passes it explicitly so unit tests can pin the behavior of
///   each strict-mode row without touching env vars.
#[must_use]
pub fn classify_delta(
    baseline: &WorkspaceHealth,
    current: &WorkspaceHealth,
    scope: &TaskScope,
    kind: TaskKind,
    strict: bool,
) -> HealthDelta {
    if has_new_errors(baseline, current) || test_regressed(baseline, current) {
        return HealthDelta {
            verdict: HealthVerdict::Regressed,
            reason: REASON_REGRESSED,
            advisory_summary: Some(summarize_new_errors(baseline, current)),
        };
    }

    let baseline_failing = baseline.is_failing();
    let current_failing = current.is_failing();

    if baseline_failing && !current_failing {
        return HealthDelta {
            verdict: HealthVerdict::Improved,
            reason: REASON_IMPROVED,
            advisory_summary: None,
        };
    }

    if !baseline_failing && !current_failing {
        return HealthDelta {
            verdict: HealthVerdict::Clean,
            reason: REASON_CLEAN,
            advisory_summary: None,
        };
    }

    // Both failing. The "no new errors" branch (above) already proved
    // the current red set is a subset of baseline, so we're in the
    // "failing → failing, unchanged" row.
    let errors = current.errors();
    if scope.intersects_errors(errors) {
        return HealthDelta {
            verdict: HealthVerdict::UnfixedInScope,
            reason: REASON_UNFIXED_IN_SCOPE,
            advisory_summary: Some(summarize_scope_hits(scope, errors)),
        };
    }

    match kind {
        TaskKind::Implementation | TaskKind::Unknown => HealthDelta {
            verdict: HealthVerdict::RedBlockingImplementation,
            reason: REASON_RED_BLOCKING_IMPL,
            advisory_summary: Some(summarize_errors(errors)),
        },
        TaskKind::Documentation | TaskKind::Refactor | TaskKind::Verification => {
            if strict {
                HealthDelta {
                    verdict: HealthVerdict::RedBlockedByStrictMode,
                    reason: REASON_RED_BLOCKED_BY_STRICT,
                    advisory_summary: Some(summarize_errors(errors)),
                }
            } else {
                HealthDelta {
                    verdict: HealthVerdict::UnchangedAdvisory,
                    reason: REASON_UNCHANGED_ADVISORY,
                    advisory_summary: Some(summarize_errors(errors)),
                }
            }
        }
    }
}

/// True when `current` contains a `(file, code, kind)` triple absent
/// from `baseline`. Cheap: linear scan; the workspace error count is
/// expected to stay in the dozens.
fn has_new_errors(baseline: &WorkspaceHealth, current: &WorkspaceHealth) -> bool {
    let baseline_errors = baseline.errors();
    current
        .errors()
        .iter()
        .any(|err| !baseline_errors.contains(err))
}

/// True when tests went from `Passing` to `Failing`. `Unknown` on
/// either side does NOT count as a regression — the snapshot policy
/// is allowed to skip tests for latency without tripping the gate.
fn test_regressed(baseline: &WorkspaceHealth, current: &WorkspaceHealth) -> bool {
    use crate::health::types::TestStatus;
    matches!(baseline.test_status, TestStatus::Passing)
        && matches!(current.test_status, TestStatus::Failing)
}

/// Short summary of the brand-new errors. Used as the `Regressed`
/// advisory text.
fn summarize_new_errors(baseline: &WorkspaceHealth, current: &WorkspaceHealth) -> String {
    let baseline_errors = baseline.errors();
    let new_errors: Vec<&HealthError> = current
        .errors()
        .iter()
        .filter(|err| !baseline_errors.contains(err))
        .collect();
    if new_errors.is_empty() {
        // Build was clean → failing fully via test regression; lean on
        // the build status to phrase the summary. `Unknown` shouldn't
        // reach this branch (regression requires a Passing→Failing
        // test flip, which means we _did_ observe both subsystems),
        // but stay defensive and use the same phrasing as `Passing`.
        return match current.build_status {
            BuildStatus::Passing | BuildStatus::Unknown => {
                "tests regressed in this snapshot window".to_owned()
            }
            BuildStatus::Failing { .. } => "workspace regressed".to_owned(),
        };
    }
    format!(
        "regressed: {} new error(s) {}",
        new_errors.len(),
        format_grouped_summary(&new_errors),
    )
}

/// Short summary of the still-red errors that fall inside `scope`.
fn summarize_scope_hits(scope: &TaskScope, errors: &[HealthError]) -> String {
    let in_scope: Vec<&HealthError> = errors
        .iter()
        .filter(|e| scope.contains_file(&e.file))
        .collect();
    format!(
        "scope still red: {} error(s) {}",
        in_scope.len(),
        format_grouped_summary(&in_scope),
    )
}

/// Short summary of every error in `errors`, used by
/// `RedBlockingImplementation`, `RedBlockedByStrictMode`, and the
/// advisory-only `UnchangedAdvisory` verdict.
fn summarize_errors(errors: &[HealthError]) -> String {
    let refs: Vec<&HealthError> = errors.iter().collect();
    format!(
        "workspace red: {} error(s) {}",
        refs.len(),
        format_grouped_summary(&refs),
    )
}

/// Group errors by crate / top-level directory and produce a human-
/// readable bracketed summary (e.g. `in zero-storage (3), foo (1)`).
/// Deterministic order — sorted alphabetically by group key.
fn format_grouped_summary(errors: &[&HealthError]) -> String {
    if errors.is_empty() {
        return "(none)".to_owned();
    }
    let mut by_group: BTreeMap<String, Vec<&HealthError>> = BTreeMap::new();
    for err in errors {
        let key = if let Some(rest) = err.file.strip_prefix("crates/") {
            rest.split('/').next().unwrap_or(rest).to_owned()
        } else if let Some(rest) = err.file.strip_prefix("apps/") {
            rest.split('/').next().unwrap_or(rest).to_owned()
        } else if let Some((head, _)) = err.file.split_once('/') {
            head.to_owned()
        } else if err.file.is_empty() {
            "<unknown>".to_owned()
        } else {
            err.file.clone()
        };
        by_group.entry(key).or_default().push(err);
    }
    let parts: Vec<String> = by_group
        .iter()
        .map(|(group, errs)| {
            let codes: Vec<&str> = errs
                .iter()
                .filter_map(|e| e.code.as_deref())
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
            if codes.is_empty() {
                format!("{group} ({})", errs.len())
            } else {
                format!("{group} ({}, {})", errs.len(), codes.join(" + "))
            }
        })
        .collect();
    format!("in {}", parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::task_scope::extract_task_scope;
    use crate::health::types::{BuildStatus, HealthError, TestStatus, WorkspaceHealth};

    fn err(file: &str, code: &str, kind: &str) -> HealthError {
        HealthError {
            file: file.to_owned(),
            code: Some(code.to_owned()),
            kind: kind.to_owned(),
        }
    }

    fn failing(errors: Vec<HealthError>) -> WorkspaceHealth {
        WorkspaceHealth {
            build_status: BuildStatus::Failing { errors },
            test_status: TestStatus::Unknown,
        }
    }

    fn clean() -> WorkspaceHealth {
        WorkspaceHealth::clean()
    }

    /// Row 1: any → regressed → `workspace_health_regressed`, blocks.
    #[test]
    fn row_regressed_blocks_with_reason_workspace_health_regressed() {
        let baseline = failing(vec![err("crates/foo/src/lib.rs", "E0277", "trait")]);
        let current = failing(vec![
            err("crates/foo/src/lib.rs", "E0277", "trait"),
            err("crates/bar/src/lib.rs", "E0432", "unresolved import"),
        ]);
        let delta = classify_delta(
            &baseline,
            &current,
            &TaskScope::default(),
            TaskKind::Implementation,
            false,
        );
        assert_eq!(delta.reason, "workspace_health_regressed");
        assert_eq!(delta.verdict, HealthVerdict::Regressed);
        assert!(delta.verdict.blocks_task_done());
    }

    /// Row 2: failing → unchanged, scope intersects red → `workspace_health_unfixed_in_scope`, blocks.
    #[test]
    fn row_unfixed_in_scope_blocks_with_reason_workspace_health_unfixed_in_scope() {
        let errors = vec![err(
            "crates/zero-storage/src/key.rs",
            "E0277",
            "trait not implemented for [u8; 64]",
        )];
        let baseline = failing(errors.clone());
        let current = failing(errors);
        let scope = extract_task_scope("Fix the crates/zero-storage red", &[]);
        let delta = classify_delta(&baseline, &current, &scope, TaskKind::Implementation, false);
        assert_eq!(delta.reason, "workspace_health_unfixed_in_scope");
        assert_eq!(delta.verdict, HealthVerdict::UnfixedInScope);
        assert!(delta.verdict.blocks_task_done());
    }

    /// Row 3: failing → unchanged, no scope hit, Implementation kind
    /// → `workspace_health_red_blocking_implementation`, blocks.
    #[test]
    fn row_red_blocking_implementation_blocks_with_reason_workspace_health_red_blocking_implementation(
    ) {
        let errors = vec![err("crates/zero-storage/src/key.rs", "E0277", "trait")];
        let baseline = failing(errors.clone());
        let current = failing(errors);
        // Scope names a different crate so it doesn't intersect the red.
        let scope = extract_task_scope("Add a snapshot helper to crates/aura-os-automation", &[]);
        let delta = classify_delta(&baseline, &current, &scope, TaskKind::Implementation, false);
        assert_eq!(delta.reason, "workspace_health_red_blocking_implementation");
        assert_eq!(delta.verdict, HealthVerdict::RedBlockingImplementation);
        assert!(delta.verdict.blocks_task_done());
    }

    /// Row 4: failing → unchanged, no scope hit, Documentation kind,
    /// strict OFF → `workspace_health_unchanged_advisory`, does NOT block.
    #[test]
    fn row_unchanged_advisory_does_not_block_with_reason_workspace_health_unchanged_advisory() {
        let errors = vec![err("crates/zero-storage/src/key.rs", "E0277", "trait")];
        let baseline = failing(errors.clone());
        let current = failing(errors);
        let scope = extract_task_scope("Write the new README.md", &[]);
        let delta = classify_delta(&baseline, &current, &scope, TaskKind::Documentation, false);
        assert_eq!(delta.reason, "workspace_health_unchanged_advisory");
        assert_eq!(delta.verdict, HealthVerdict::UnchangedAdvisory);
        assert!(!delta.verdict.blocks_task_done());
        assert!(
            delta.advisory_summary.is_some(),
            "advisory rows must carry a human-readable summary"
        );
    }

    /// Row 5: failing → unchanged, no scope hit, Documentation kind,
    /// strict ON → `workspace_health_red_blocked_by_strict_mode`, blocks.
    #[test]
    fn row_red_blocked_by_strict_mode_blocks_with_reason_workspace_health_red_blocked_by_strict_mode(
    ) {
        let errors = vec![err("crates/zero-storage/src/key.rs", "E0277", "trait")];
        let baseline = failing(errors.clone());
        let current = failing(errors);
        let scope = extract_task_scope("Write the new README.md", &[]);
        let delta = classify_delta(&baseline, &current, &scope, TaskKind::Documentation, true);
        assert_eq!(delta.reason, "workspace_health_red_blocked_by_strict_mode");
        assert_eq!(delta.verdict, HealthVerdict::RedBlockedByStrictMode);
        assert!(delta.verdict.blocks_task_done());
    }

    /// Row 6: failing → improved/clean → `workspace_health_improved`, does NOT block.
    #[test]
    fn row_improved_does_not_block_with_reason_workspace_health_improved() {
        let baseline = failing(vec![err("crates/foo/src/lib.rs", "E0277", "trait")]);
        let current = clean();
        let delta = classify_delta(
            &baseline,
            &current,
            &TaskScope::default(),
            TaskKind::Implementation,
            true, // strict on does not change the improved verdict
        );
        assert_eq!(delta.reason, "workspace_health_improved");
        assert_eq!(delta.verdict, HealthVerdict::Improved);
        assert!(!delta.verdict.blocks_task_done());
    }

    /// Row 7: clean → clean → `workspace_health_clean`, does NOT block.
    #[test]
    fn row_clean_does_not_block_with_reason_workspace_health_clean() {
        let baseline = clean();
        let current = clean();
        let delta = classify_delta(
            &baseline,
            &current,
            &TaskScope::default(),
            TaskKind::Documentation,
            true,
        );
        assert_eq!(delta.reason, "workspace_health_clean");
        assert_eq!(delta.verdict, HealthVerdict::Clean);
        assert!(!delta.verdict.blocks_task_done());
    }

    /// Row 8: baseline absent → `workspace_health_unknown_baseline`, does NOT block.
    #[test]
    fn row_unknown_baseline_does_not_block_with_reason_workspace_health_unknown_baseline() {
        let delta = HealthDelta::unknown_baseline();
        assert_eq!(delta.reason, "workspace_health_unknown_baseline");
        assert_eq!(delta.verdict, HealthVerdict::UnknownBaseline);
        assert!(!delta.verdict.blocks_task_done());
        assert!(delta.advisory_summary.is_none());
    }

    // -----------------------------------------------------------------
    // Phase 4a of `workspace-health-diff-gate`: blocking-reason
    // predicates that the App layer + the aura-os-harness completion
    // classifier use to route the four blocking verdicts through the
    // pre-existing `CompletionContract` retry path.
    // -----------------------------------------------------------------

    #[test]
    fn is_workspace_health_blocking_reason_matches_each_of_the_four_blocking_variants() {
        for reason in [
            REASON_REGRESSED,
            REASON_UNFIXED_IN_SCOPE,
            REASON_RED_BLOCKING_IMPL,
            REASON_RED_BLOCKED_BY_STRICT,
        ] {
            assert!(
                is_workspace_health_blocking_reason(reason),
                "blocking reason {reason:?} must match",
            );
            assert!(
                contains_workspace_health_blocking_reason(reason),
                "blocking reason {reason:?} must also match the substring predicate",
            );
        }
    }

    #[test]
    fn is_workspace_health_blocking_reason_rejects_each_of_the_four_non_blocking_variants() {
        for reason in [
            REASON_IMPROVED,
            REASON_CLEAN,
            REASON_UNCHANGED_ADVISORY,
            REASON_UNKNOWN_BASELINE,
        ] {
            assert!(
                !is_workspace_health_blocking_reason(reason),
                "non-blocking advisory reason {reason:?} must NOT match",
            );
            assert!(
                !contains_workspace_health_blocking_reason(reason),
                "non-blocking advisory reason {reason:?} must NOT match the substring predicate",
            );
        }
    }

    #[test]
    fn contains_workspace_health_blocking_reason_matches_embedded_reason_substring() {
        // The harness wraps blocking reasons in a larger error message
        // when emitting them via `task_failed`. The substring
        // predicate must still match so the completion-contract
        // classifier can route the failure into a fresh-context
        // retry.
        let wrapped = "agent execution error: workspace_health_regressed at task_done";
        assert!(
            contains_workspace_health_blocking_reason(wrapped),
            "wrapped blocking reason must match the substring predicate: {wrapped}",
        );
        assert!(
            !is_workspace_health_blocking_reason(wrapped),
            "wrapped blocking reason must NOT match the exact-equality predicate: {wrapped}",
        );
    }

    #[test]
    fn contains_workspace_health_blocking_reason_is_case_insensitive() {
        let upper = "AGENT EXECUTION ERROR: WORKSPACE_HEALTH_UNFIXED_IN_SCOPE";
        assert!(
            contains_workspace_health_blocking_reason(upper),
            "uppercase wrapping must still match because the predicate lowercases first",
        );
    }
}
