//! Workspace-health diff classifier.
//!
//! Pure function — takes two [`WorkspaceHealth`] snapshots and returns
//! a [`HealthDelta`]. No I/O, no async, no storage access; the App
//! layer is responsible for collecting the inputs and acting on the
//! verdict.
//!
//! The single rule: a `task_completed` is demoted to `task_failed`
//! when the current snapshot has more errors than the baseline, OR
//! when tests went from `Passing` to `Failing`. Every other case
//! lets the harness's `task_completed` through.

use std::collections::BTreeMap;

use super::types::{
    BuildStatus, HealthDelta, HealthError, HealthVerdict, TestStatus, WorkspaceHealth,
};

/// Reason string for [`HealthVerdict::Improved`].
pub(crate) const REASON_IMPROVED: &str = "workspace_health_improved";
/// Reason string for [`HealthVerdict::Clean`].
pub(crate) const REASON_CLEAN: &str = "workspace_health_clean";
/// Reason string for [`HealthVerdict::Unchanged`].
pub(crate) const REASON_UNCHANGED: &str = "workspace_health_unchanged";
/// Reason string for [`HealthVerdict::Regressed`].
pub(crate) const REASON_REGRESSED: &str = "workspace_health_regressed";

/// The single `workspace_health_*` reason string that blocks
/// `task_done` (i.e. the one for which
/// [`HealthVerdict::blocks_task_done`] returns `true`).
///
/// Kept as a `const` slice so the App layer and the cross-crate
/// `aura-os-harness` predicate can iterate the same set without
/// re-typing the literal.
pub(crate) const WORKSPACE_HEALTH_BLOCKING_REASONS: &[&str] = &[REASON_REGRESSED];

/// True when `reason` is the workspace-health reason string that
/// blocks `task_done`. The non-blocking advisory reasons
/// (`workspace_health_improved`, `_clean`, `_unchanged`)
/// deliberately do NOT match.
#[must_use]
pub(crate) fn is_workspace_health_blocking_reason(reason: &str) -> bool {
    reason == REASON_REGRESSED
}

/// True when `reason` (case-insensitively) contains the workspace-
/// health blocking reason substring.
///
/// Used by the cross-layer completion-contract classifier so the
/// `is_completion_contract_failure` path matches whether the reason
/// arrives bare (`workspace_health_regressed`) or wrapped in a
/// larger error message (`"agent execution error:
/// workspace_health_regressed at task_done"`).
#[must_use]
pub(crate) fn contains_workspace_health_blocking_reason(reason: &str) -> bool {
    let lower = reason.to_ascii_lowercase();
    lower.contains(REASON_REGRESSED)
}

/// Classify the difference between `baseline` and `current`.
///
/// Pure: no I/O, no env reads, no global state. Returns one of:
///
/// * [`HealthVerdict::Regressed`] — `current` has more errors than
///   `baseline`, OR `current.test_status == Failing` while
///   `baseline.test_status != Failing`. Blocks `task_done`.
/// * [`HealthVerdict::Improved`] — `baseline` was failing and
///   `current` no longer is. Non-blocking.
/// * [`HealthVerdict::Clean`] — both snapshots non-failing. Non-
///   blocking.
/// * [`HealthVerdict::Unchanged`] — both snapshots failing but
///   `current` is not worse than `baseline`. Non-blocking.
#[must_use]
pub fn classify_delta(baseline: &WorkspaceHealth, current: &WorkspaceHealth) -> HealthDelta {
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

    HealthDelta {
        verdict: HealthVerdict::Unchanged,
        reason: REASON_UNCHANGED,
        advisory_summary: Some(summarize_errors(current.errors())),
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

/// Short summary of every error in `errors`, used by the `Unchanged`
/// advisory verdict.
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
    use super::super::types::{BuildStatus, HealthError, TestStatus, WorkspaceHealth};

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

    /// More errors in current than baseline → `Regressed`, blocks.
    #[test]
    fn errors_up_blocks_with_reason_workspace_health_regressed() {
        let baseline = failing(vec![err("crates/foo/src/lib.rs", "E0277", "trait")]);
        let current = failing(vec![
            err("crates/foo/src/lib.rs", "E0277", "trait"),
            err("crates/bar/src/lib.rs", "E0432", "unresolved import"),
        ]);
        let delta = classify_delta(&baseline, &current);
        assert_eq!(delta.reason, REASON_REGRESSED);
        assert_eq!(delta.verdict, HealthVerdict::Regressed);
        assert!(delta.verdict.blocks_task_done());
    }

    /// Tests went from passing to failing → `Regressed`, blocks.
    #[test]
    fn tests_passing_to_failing_blocks_with_reason_workspace_health_regressed() {
        let baseline = WorkspaceHealth {
            build_status: BuildStatus::Passing,
            test_status: TestStatus::Passing,
        };
        let current = WorkspaceHealth {
            build_status: BuildStatus::Passing,
            test_status: TestStatus::Failing,
        };
        let delta = classify_delta(&baseline, &current);
        assert_eq!(delta.reason, REASON_REGRESSED);
        assert!(delta.verdict.blocks_task_done());
    }

    /// Baseline failing, current clean → `Improved`, does NOT block.
    #[test]
    fn improved_does_not_block() {
        let baseline = failing(vec![err("crates/foo/src/lib.rs", "E0277", "trait")]);
        let current = clean();
        let delta = classify_delta(&baseline, &current);
        assert_eq!(delta.reason, REASON_IMPROVED);
        assert_eq!(delta.verdict, HealthVerdict::Improved);
        assert!(!delta.verdict.blocks_task_done());
    }

    /// Both snapshots clean → `Clean`, does NOT block.
    #[test]
    fn clean_does_not_block() {
        let delta = classify_delta(&clean(), &clean());
        assert_eq!(delta.reason, REASON_CLEAN);
        assert_eq!(delta.verdict, HealthVerdict::Clean);
        assert!(!delta.verdict.blocks_task_done());
    }

    /// Failing → failing with identical errors → `Unchanged`, does
    /// NOT block. This is the key relaxation: a red workspace at
    /// task start does not by itself fail the task.
    #[test]
    fn unchanged_red_does_not_block() {
        let errors = vec![err(
            "crates/zero-storage/src/key.rs",
            "E0277",
            "trait not implemented for [u8; 64]",
        )];
        let baseline = failing(errors.clone());
        let current = failing(errors);
        let delta = classify_delta(&baseline, &current);
        assert_eq!(delta.reason, REASON_UNCHANGED);
        assert_eq!(delta.verdict, HealthVerdict::Unchanged);
        assert!(!delta.verdict.blocks_task_done());
        assert!(
            delta.advisory_summary.is_some(),
            "unchanged-red verdict must carry a human-readable summary"
        );
    }

    /// Baseline absent → caller passes the unknown-constructed
    /// snapshot in; classifier treats Unknown as "not failing" so
    /// it routes through Clean and does NOT block.
    #[test]
    fn unknown_baseline_does_not_block() {
        let baseline = WorkspaceHealth::unknown();
        let current = WorkspaceHealth::unknown();
        let delta = classify_delta(&baseline, &current);
        assert!(!delta.verdict.blocks_task_done());
    }

    #[test]
    fn is_workspace_health_blocking_reason_matches_only_regressed() {
        assert!(is_workspace_health_blocking_reason(REASON_REGRESSED));
        assert!(contains_workspace_health_blocking_reason(REASON_REGRESSED));
        for reason in [REASON_IMPROVED, REASON_CLEAN, REASON_UNCHANGED] {
            assert!(
                !is_workspace_health_blocking_reason(reason),
                "non-blocking reason {reason:?} must NOT match",
            );
            assert!(
                !contains_workspace_health_blocking_reason(reason),
                "non-blocking reason {reason:?} must NOT match the substring predicate",
            );
        }
    }

    #[test]
    fn contains_workspace_health_blocking_reason_matches_embedded_reason_substring() {
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
        let upper = "AGENT EXECUTION ERROR: WORKSPACE_HEALTH_REGRESSED";
        assert!(
            contains_workspace_health_blocking_reason(upper),
            "uppercase wrapping must still match because the predicate lowercases first",
        );
    }
}
