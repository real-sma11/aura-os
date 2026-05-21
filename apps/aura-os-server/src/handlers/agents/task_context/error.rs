//! Error type returned by the task-context fetcher.
//!
//! Originally lived as `automation::AutomationError`. After
//! the automation crate was folded into the server, only the
//! task-context resolver still surfaces errors through it, so the
//! type lives next to its caller.

use thiserror::Error;

/// Errors produced by the task-context resolver fetcher.
///
/// New variants are added as new failure modes appear. Production
/// code must match exhaustively rather than relying on a wildcard
/// arm so the compiler flags every new case.
#[derive(Debug, Error)]
#[non_exhaustive]
pub(crate) enum TaskContextError {
    /// A harness event did not carry the structure the resolver
    /// expected. `detail` is a short human-readable summary suitable
    /// for logging; it must not include user data that could inflate
    /// the log volume.
    #[error("invalid harness event: {detail}")]
    InvalidHarnessEvent {
        /// Short diagnostic describing which field was missing or
        /// malformed.
        detail: String,
    },
}
