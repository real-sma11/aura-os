//! Shared data types for the workspace-health diff gate.
//!
//! Phase 1 of `workspace-health-diff-gate`. These types are pure data
//! containers consumed by [`super::delta::classify_delta`] (the 8-row
//! verdict matrix), [`super::task_kind::classify_task_kind`], and
//! [`super::task_scope::extract_task_scope`]. They MUST stay free of
//! I/O, async machinery, and any dependency on `aura-os-storage` or the
//! server crate — the App layer constructs them from `cargo check` /
//! test output and threads them through the dev-loop state machine.
//!
//! The eight verdict variants in [`HealthVerdict`] and the matching
//! `reason` strings exported by [`super::delta`] match the matrix
//! documented in
//! `c:\Users\n3o\.cursor\plans\workspace-health-diff-gate_1121eaf1.plan.md`
//! word-for-word; downstream phases (snapshot at claim, completion gate,
//! ExplorationBudget advisory) read those reasons verbatim.

/// One diagnostic from a build/test signal.
///
/// `code` is `None` for diagnostics that don't carry a structured error
/// code (e.g. plain panics, linker errors, generic test failures).
/// `kind` carries the human-readable message line so the advisory text
/// can surface concrete signal to the agent even when there's no code.
///
/// The triple `(file, code, kind)` is what
/// [`super::snapshot::Snapshot`] hashes into its signature — line and
/// column numbers are deliberately ignored so trivial reformatting
/// upstream of a stable error does not look like a regression.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Ord, PartialOrd)]
pub struct HealthError {
    /// Source file the diagnostic was emitted against, normalized
    /// to a workspace-relative path when possible.
    pub file: String,
    /// Optional error code (e.g. `E0277`, `clippy::needless_clone`).
    /// `None` when the upstream tool didn't supply one.
    pub code: Option<String>,
    /// Short human-readable category / first message line. Plays the
    /// role of an error-kind discriminant in
    /// [`super::snapshot::Snapshot`]'s signature.
    pub kind: String,
}

/// Status of the build subsystem (`cargo check --workspace --tests` or
/// equivalent) at snapshot time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BuildStatus {
    /// No diagnostics at the `error` level.
    Passing,
    /// One or more `error`-level diagnostics. The vector preserves the
    /// order the upstream parser emitted them; consumers should treat
    /// it as an unordered multiset for diff purposes.
    Failing {
        /// All error-level diagnostics observed in this snapshot
        /// window.
        errors: Vec<HealthError>,
    },
}

/// Status of the test subsystem at snapshot time.
///
/// [`TestStatus::Unknown`] means "no test command ran in this snapshot
/// window" — the App layer's snapshot policy decides whether to invoke
/// the test runner at all, and the diff gate treats `Unknown` as
/// neither a regression nor a clean signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TestStatus {
    /// All run tests passed.
    Passing,
    /// At least one test failed.
    Failing,
    /// No test command was run, or the test run did not produce a
    /// usable verdict. Treated as a no-op by the diff classifier.
    Unknown,
}

/// Cheap "is the workspace red?" fingerprint computed at task claim and
/// at `task_done`.
///
/// Phase 1 stays pure: the App layer (Phase 2/3) is responsible for
/// invoking `cargo check`, `cargo test`, etc. and constructing the
/// value from their output via [`super::snapshot::parse_cargo_check_json_output`]
/// and friends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceHealth {
    /// Build subsystem verdict.
    pub build_status: BuildStatus,
    /// Test subsystem verdict.
    pub test_status: TestStatus,
}

impl WorkspaceHealth {
    /// Construct a `WorkspaceHealth` that's passing on both subsystems
    /// (a "green" baseline).
    #[must_use]
    pub fn clean() -> Self {
        Self {
            build_status: BuildStatus::Passing,
            test_status: TestStatus::Passing,
        }
    }

    /// Construct a `WorkspaceHealth` with a failing build and the given
    /// errors. Test status is left as [`TestStatus::Unknown`] — the
    /// caller can mutate it afterwards if a test run also produced a
    /// verdict.
    #[must_use]
    pub fn failing(errors: Vec<HealthError>) -> Self {
        Self {
            build_status: BuildStatus::Failing { errors },
            test_status: TestStatus::Unknown,
        }
    }

    /// True when the build is passing and tests are not failing.
    /// `TestStatus::Unknown` does NOT prevent a clean verdict — the
    /// snapshot window may legitimately skip tests for latency.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        matches!(self.build_status, BuildStatus::Passing)
            && !matches!(self.test_status, TestStatus::Failing)
    }

    /// True when the build is failing OR tests are explicitly failing.
    #[must_use]
    pub fn is_failing(&self) -> bool {
        matches!(self.build_status, BuildStatus::Failing { .. })
            || matches!(self.test_status, TestStatus::Failing)
    }

    /// Borrow the build-error slice. Returns an empty slice for
    /// `BuildStatus::Passing` so callers don't have to pattern-match.
    #[must_use]
    pub fn errors(&self) -> &[HealthError] {
        match &self.build_status {
            BuildStatus::Failing { errors } => errors,
            BuildStatus::Passing => &[],
        }
    }
}

/// Coarse task classification driving the strict-mode advisory split.
///
/// Only the **kind** matters to the diff gate; the actual task ID /
/// description live elsewhere. [`TaskKind::Unknown`] is reserved for
/// empty inputs and forces the safe-default branch (treated as
/// `Implementation` in the verdict matrix).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskKind {
    /// Code changes that produce new behavior (default).
    Implementation,
    /// Doc-only changes — `*.md`, `docs/**`, etc.
    Documentation,
    /// Pure rename / move / structural refactor with no behavioral
    /// change intended.
    Refactor,
    /// Audit, review, "check that X is true" — no expected file ops.
    Verification,
    /// Empty description and empty scope. Treated as
    /// `Implementation` by the verdict matrix (safe default that
    /// blocks red workspaces) while staying distinguishable from a
    /// stamped `Implementation` for logging.
    Unknown,
}

/// One of the eight verdicts in the diff matrix. The matching
/// machine-readable `reason` strings live next to
/// [`super::delta::classify_delta`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthVerdict {
    /// Baseline failing, current improved or clean.
    Improved,
    /// Both baseline and current clean.
    Clean,
    /// Failing → failing, no scope hit, doc/refactor/verification
    /// task, strict mode OFF. Non-blocking advisory only.
    UnchangedAdvisory,
    /// Current has errors not in baseline. Always blocks.
    Regressed,
    /// Failing → failing, scope intersects the still-red files.
    /// Always blocks: the task claimed to touch the broken area but
    /// didn't fix it.
    UnfixedInScope,
    /// Failing → failing, no scope hit, Implementation kind. Blocks
    /// the task from claiming done while the workspace is red.
    RedBlockingImplementation,
    /// Failing → failing, no scope hit, doc/refactor/verification
    /// task, strict mode ON. Blocks under the operator-opt-in
    /// strict policy that the previous chat's task 3.9 motivates.
    RedBlockedByStrictMode,
    /// Baseline absent — caller should fall back to the existing
    /// completion gate. Never blocks on its own.
    UnknownBaseline,
}

impl HealthVerdict {
    /// True when the verdict should reject a `task_done` call.
    ///
    /// Locked down by the matrix from the plan: only the four
    /// `Regressed` / `UnfixedInScope` / `RedBlockingImplementation` /
    /// `RedBlockedByStrictMode` variants block. Every other verdict
    /// (including `UnknownBaseline`) lets `task_done` through and
    /// defers to the pre-existing gate.
    #[must_use]
    pub fn blocks_task_done(self) -> bool {
        matches!(
            self,
            HealthVerdict::Regressed
                | HealthVerdict::UnfixedInScope
                | HealthVerdict::RedBlockingImplementation
                | HealthVerdict::RedBlockedByStrictMode
        )
    }
}

/// Output of [`super::delta::classify_delta`].
///
/// `reason` is one of the `workspace_health_*` machine-readable
/// strings defined as `const`s in [`super::delta`]; downstream phases
/// pattern-match on them verbatim. `advisory_summary` carries a
/// short human-readable string for prompt headers / completion
/// rejection messages — `None` when the verdict has nothing useful to
/// say (clean ↔ clean, unknown baseline).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthDelta {
    /// Verdict variant (drives `blocks_task_done`).
    pub verdict: HealthVerdict,
    /// Stable machine-readable reason string. One of the
    /// `workspace_health_*` constants in [`super::delta`].
    pub reason: &'static str,
    /// Optional human-readable summary for prompt headers.
    pub advisory_summary: Option<String>,
}
