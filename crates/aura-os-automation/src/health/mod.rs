//! Workspace-health diff gate for the autonomous dev loop.
//!
//! Owns the pure types + classification logic the App layer wires
//! into the `task_started` baseline snapshot and the `task_done`
//! completion gate.
//!
//! ## Surface
//!
//! * Data types — [`WorkspaceHealth`], [`BuildStatus`], [`TestStatus`],
//!   [`HealthError`], [`HealthDelta`], [`HealthVerdict`].
//! * Pure classifiers — [`classify_delta`],
//!   [`snapshot::parse_cargo_check_json_output`].
//! * Content-hash snapshot — [`snapshot::Snapshot`] +
//!   [`snapshot::compute_signature`].
//!
//! Everything is `#[must_use]` and side-effect-free; the App layer is
//! responsible for invoking `cargo check`, capturing stdout, and
//! constructing the values.

pub mod delta;
pub mod snapshot;
pub mod types;

pub use delta::{
    classify_delta, contains_workspace_health_blocking_reason, is_workspace_health_blocking_reason,
    REASON_CLEAN, REASON_IMPROVED, REASON_REGRESSED, REASON_UNCHANGED,
    WORKSPACE_HEALTH_BLOCKING_REASONS,
};
pub use snapshot::{compute_signature, parse_cargo_check_json_output, Snapshot};
pub use types::{
    BuildStatus, HealthDelta, HealthError, HealthVerdict, TestStatus, WorkspaceHealth,
};
