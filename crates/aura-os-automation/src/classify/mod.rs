//! Failure-reason classifiers shared by dev-loop and chat agents.
//!
//! Phase 1 of `simplify dev-loop / harness automation`: the substring
//! classifier family that used to live in [`transient`] has been
//! deleted and the restart-decision gates that composed on top of it
//! ([`should_restart_on_error`], [`tool_call_failed_should_retry`],
//! [`classify_restart_reason`]) have moved to
//! `apps/aura-os-server/src/handlers/dev_loop/signals/classifiers.rs`
//! where they can drive off the typed
//! [`aura_os_harness::signals::HarnessFailureKind`] enum directly.
//!
//! What remains:
//!
//! * [`push`] — git-push-failure subclassification used by the
//!   reconciler and DoD evidence helpers. Self-contained (no
//!   dependency on the deleted substring matchers).
//!
//! [`should_restart_on_error`]: deleted
//! [`tool_call_failed_should_retry`]: deleted
//! [`classify_restart_reason`]: deleted

pub mod push;

#[cfg(test)]
mod tests;

pub use push::classify_push_failure;
