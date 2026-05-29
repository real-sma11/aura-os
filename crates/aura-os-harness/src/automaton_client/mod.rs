//! Automaton run-request building + identity preflight.
//!
//! Originally an HTTP + WebSocket client (`AutomatonClient`) for the
//! harness automaton REST API. The transport collapsed onto the
//! canonical [`crate::HarnessLink`] surface in the harness-unification
//! refactor; what remains are the request-shaping
//! ([`AutomatonStartParams`] → [`crate::RuntimeRequest`]) and
//! identity-preflight helpers the dev-loop start path still builds on.

mod identity;
mod start_params;

#[cfg(test)]
mod tests;

pub use identity::validate_automaton_start_identity;
#[allow(unused_imports)]
pub(crate) use start_params::automaton_start_params_to_runtime_request;
pub use start_params::{AutomatonStartError, AutomatonStartParams};

// Brought into the `automaton_client` namespace so the `tests` submodule
// can reach `normalize_automaton_event` through `super::normalize_automaton_event`
// without exposing it as part of the crate's public API.
#[cfg(test)]
use crate::event_normalization::normalize_automaton_event;
