//! Workspace-health diff gate for the autonomous dev loop.
//!
//! Owns the pure types + classification logic the dev-loop wires into
//! the `task_started` baseline snapshot and the `task_done` completion
//! gate.
//!
//! ## Surface
//!
//! * Data types — [`WorkspaceHealth`], [`BuildStatus`], [`TestStatus`],
//!   [`HealthError`], [`HealthDelta`], [`HealthVerdict`].
//! * Pure classifiers — [`classify_delta`],
//!   [`snapshot::parse_cargo_check_json_output`].
//! * Content-hash snapshot — [`snapshot::Snapshot`] +
//!   [`snapshot::compute_signature`].
//! * Baseline tracker — [`baseline::HealthBaselineTracker`].
//!
//! All pure functions and data types are `#[must_use]` and
//! side-effect-free; the snapshot runner under
//! `signals::health_snapshot` is responsible for invoking
//! `cargo check`, capturing stdout, and constructing the values.

pub(crate) mod baseline;
pub(crate) mod delta;
pub(crate) mod snapshot;
pub(crate) mod summary;
pub(crate) mod types;

#[allow(unused_imports)]
pub(crate) use baseline::{BaselineEntry, HealthBaselineTracker};
pub use delta::classify_delta;
#[allow(unused_imports)]
pub(crate) use delta::{
    contains_workspace_health_blocking_reason, is_workspace_health_blocking_reason, REASON_CLEAN,
    REASON_IMPROVED, REASON_REGRESSED, REASON_UNCHANGED, WORKSPACE_HEALTH_BLOCKING_REASONS,
};
#[allow(unused_imports)]
pub(crate) use snapshot::{compute_signature, parse_cargo_check_json_output, Snapshot};
pub(crate) use summary::format_health_summary;
pub use types::{
    BuildStatus, HealthDelta, HealthError, HealthVerdict, TestStatus, WorkspaceHealth,
};
