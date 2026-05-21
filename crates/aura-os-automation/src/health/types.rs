//! Shared data types for the workspace-health diff gate.
//!
//! Pure data containers consumed by [`super::delta::classify_delta`].
//! They MUST stay free of I/O, async machinery, and any dependency on
//! `aura-os-storage` or the server crate — the App layer constructs
//! them from `cargo check` / test output and threads them through the
//! dev-loop state machine.

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
    /// The snapshot runner could not observe the build (cargo not on
    /// PATH, snapshot timeout, spawn failure). Distinguished from
    /// [`BuildStatus::Passing`] so the App layer can route the
    /// `WorkspaceHealth::unknown` case (Phase 3 snapshot tooling
    /// errors) into the existing `workspace_health_unknown_baseline`
    /// fall-through instead of a false-positive "clean" verdict.
    ///
    /// Neither [`WorkspaceHealth::is_clean`] nor
    /// [`WorkspaceHealth::is_failing`] returns true for `Unknown` —
    /// it is the conservative "we have no evidence either way" state.
    Unknown,
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

    /// Construct a `WorkspaceHealth` that couldn't observe either
    /// subsystem. Used by the Phase 3 snapshot runner when `cargo
    /// check` couldn't be spawned, timed out, or otherwise produced
    /// no usable verdict; the Phase 4 completion gate treats this as
    /// "no baseline" and falls back to the existing gate rather than
    /// confusing it with a clean / failing baseline.
    #[must_use]
    pub fn unknown() -> Self {
        Self {
            build_status: BuildStatus::Unknown,
            test_status: TestStatus::Unknown,
        }
    }

    /// True when the build is passing and tests are not failing.
    /// `TestStatus::Unknown` does NOT prevent a clean verdict — the
    /// snapshot window may legitimately skip tests for latency.
    /// [`BuildStatus::Unknown`] DOES prevent a clean verdict — we
    /// can't claim cleanliness without observing the build.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        matches!(self.build_status, BuildStatus::Passing)
            && !matches!(self.test_status, TestStatus::Failing)
    }

    /// True when the build is failing OR tests are explicitly failing.
    /// [`BuildStatus::Unknown`] does NOT count as failing — we don't
    /// have evidence the workspace is red, just an absence of
    /// evidence either way.
    #[must_use]
    pub fn is_failing(&self) -> bool {
        matches!(self.build_status, BuildStatus::Failing { .. })
            || matches!(self.test_status, TestStatus::Failing)
    }

    /// Borrow the build-error slice. Returns an empty slice for
    /// [`BuildStatus::Passing`] and [`BuildStatus::Unknown`] so
    /// callers don't have to pattern-match.
    #[must_use]
    pub fn errors(&self) -> &[HealthError] {
        match &self.build_status {
            BuildStatus::Failing { errors } => errors,
            BuildStatus::Passing | BuildStatus::Unknown => &[],
        }
    }
}

/// One of the four verdicts emitted by [`super::delta::classify_delta`].
/// The matching machine-readable `reason` strings live next to
/// the classifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthVerdict {
    /// Both baseline and current snapshots non-failing.
    Clean,
    /// Baseline was failing, current is no longer failing.
    Improved,
    /// Both snapshots failing but `current` is not worse than
    /// `baseline`. Non-blocking advisory only.
    Unchanged,
    /// `current` has errors absent from `baseline`, OR tests went
    /// from passing to failing. The single blocking verdict.
    Regressed,
}

impl HealthVerdict {
    /// True when the verdict should reject a `task_done` call.
    /// Only [`HealthVerdict::Regressed`] blocks; every other variant
    /// lets `task_done` through.
    #[must_use]
    pub fn blocks_task_done(self) -> bool {
        matches!(self, HealthVerdict::Regressed)
    }
}

/// Output of [`super::delta::classify_delta`].
///
/// `reason` is one of the `workspace_health_*` machine-readable
/// strings defined as `const`s in [`super::delta`]; downstream code
/// pattern-matches on them verbatim. `advisory_summary` carries a
/// short human-readable string for prompt headers / completion
/// rejection messages — `None` for the clean and improved verdicts.
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
