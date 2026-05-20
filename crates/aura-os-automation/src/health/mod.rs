//! Workspace-health diff gate for the autonomous dev loop.
//!
//! Phase 1 of `workspace-health-diff-gate` (see
//! `c:\Users\n3o\.cursor\plans\workspace-health-diff-gate_1121eaf1.plan.md`).
//! This module owns the pure types + classification logic that later
//! phases wire into:
//!
//! * Phase 2 — `ExplorationBudget` advisory text, so the in-flight
//!   prompt header names the actually-broken crate when the
//!   workspace is red.
//! * Phase 3 — task-claim snapshot path, so each task gets a
//!   `WorkspaceHealth` baseline stashed on `LoopRetryState`.
//! * Phase 4 — `task_done` completion gate, so the dev-loop's
//!   completion contract calls [`classify_delta`] against the
//!   baseline and rejects on the four blocking verdicts.
//!
//! ## Surface
//!
//! * Data types — [`WorkspaceHealth`], [`BuildStatus`], [`TestStatus`],
//!   [`HealthError`], [`TaskKind`], [`TaskScope`], [`HealthDelta`],
//!   [`HealthVerdict`].
//! * Pure classifiers — [`classify_delta`], [`classify_task_kind`],
//!   [`extract_task_scope`], [`snapshot::parse_cargo_check_json_output`].
//! * Env knobs — [`is_strict_mode_enabled`],
//!   [`baseline_reuse_max_age_secs`].
//! * Content-hash snapshot — [`snapshot::Snapshot`] +
//!   [`snapshot::compute_signature`].
//!
//! Everything is `#[must_use]` and side-effect-free; the App layer is
//! responsible for invoking `cargo check`, capturing stdout, and
//! constructing the values.

pub mod delta;
pub mod snapshot;
pub mod strict_mode;
pub mod task_kind;
pub mod task_scope;
pub mod types;

pub use delta::{
    classify_delta, contains_workspace_health_blocking_reason,
    is_workspace_health_blocking_reason, REASON_CLEAN, REASON_IMPROVED,
    REASON_RED_BLOCKED_BY_STRICT, REASON_RED_BLOCKING_IMPL, REASON_REGRESSED,
    REASON_UNCHANGED_ADVISORY, REASON_UNFIXED_IN_SCOPE, REASON_UNKNOWN_BASELINE,
    WORKSPACE_HEALTH_BLOCKING_REASONS,
};
pub use snapshot::{compute_signature, parse_cargo_check_json_output, Snapshot};
pub use strict_mode::{
    baseline_reuse_max_age_secs, is_strict_mode_enabled, DEFAULT_BASELINE_REUSE_MAX_AGE_SECS,
};
pub use task_kind::classify_task_kind;
pub use task_scope::{extract_task_scope, TaskScope};
pub use types::{
    BuildStatus, HealthDelta, HealthError, HealthVerdict, TaskKind, TestStatus, WorkspaceHealth,
};
