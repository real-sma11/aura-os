//! HTTP + WebSocket client for the harness automaton REST API.
//!
//! Provides typed methods for starting, stopping, pausing automatons and
//! subscribing to their event streams -- used by `dev_loop.rs` instead of the
//! old chat-session-based approach.

mod client;
mod identity;
mod start_params;

#[cfg(test)]
mod tests;

pub use client::AutomatonClient;
pub use identity::validate_automaton_start_identity;
#[allow(unused_imports)]
pub(crate) use start_params::automaton_start_params_to_runtime_request;
pub use start_params::{AutomatonStartError, AutomatonStartParams};

// Brought into the `automaton_client` namespace so the `tests` submodule
// can reach `normalize_automaton_event` through `super::normalize_automaton_event`
// without exposing it as part of the crate's public API.
#[cfg(test)]
use crate::event_normalization::normalize_automaton_event;
