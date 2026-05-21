//! Workspace-health baseline tracker shared by the dev-loop and chat
//! agent.
//!
//! Phase 4 of the dev-loop simplification deleted the parallel
//! retry state machine that used to live next to this tracker.
//! The single retry decision now lives in
//! [`aura_os_harness::signals::HarnessFailureKind::is_retryable`]
//! and the per-task attempt count lives on the persisted
//! `tasks.attempts` column. The only piece of in-memory state left in
//! this module is the `HealthBaselineTracker`, which the surviving
//! workspace-health completion gate uses to stash the
//! `task_started` `cargo check` snapshot for the `task_completed`
//! comparison.

pub mod health_baseline;

pub use health_baseline::{BaselineEntry, HealthBaselineTracker};
