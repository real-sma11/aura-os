//! Pure mapping from harness wire events to dev-loop activity
//! transitions.
//!
//! ## Why pure
//!
//! Keeping the `(current, event_kind) -> Option<Transition>` function
//! pure means the server-side adapter in
//! `streaming::activity` stays trivial and the table-driven tests in
//! the colocated `tests` module can run without an async runtime.
//!
//! ## What's not here
//!
//! * Terminal mark-completed / mark-failed flows. Those are driven by
//!   `RunCompletion` in the harness collector and live on
//!   `LoopHandle` directly; the streaming shim handles them.
//! * Tool-name extraction. The pure mapper signals "this event moves
//!   us to `WaitingTool`" and the server-side shim pulls the tool
//!   name out of the event payload because that requires
//!   `serde_json::Value` access. Keeping `serde_json` out of the
//!   pure surface lets the test layer construct transitions with
//!   simple structs.

pub(crate) mod activity;

#[cfg(test)]
mod tests;

pub(crate) use activity::{apply_loop_activity, LoopActivityTransition};
