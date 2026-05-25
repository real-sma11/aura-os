//! Wire-compatible agent identity bundle.
//!
//! Mirror of `aura_harness::aura_protocol::AgentIdentityWire`. The
//! aura-os producer side fills this in from the `agent_instance` row
//! (PR C of the system-prompt simplification plan) and serialises it
//! onto `AutomatonStartParams`. The harness re-borrows it as
//! `aura_agent::prompts::AgentIdentity<'_>` when assembling the
//! dev-loop / task-run system prompt's `<agent_identity>` section.
//!
//! Lives in `aura-protocol` (rather than `aura-os-harness`) so any
//! future client-side caller (eval harness, OpenAPI generator, etc.)
//! can reach it from a stable location.

use serde::{Deserialize, Serialize};

#[cfg(feature = "typescript")]
use ts_rs::TS;

/// Free-form agent identity surfaced into the dev-loop / task-run
/// system prompt's `<agent_identity>` section.
///
/// Every field is best-effort prose: aura-os reads it off the
/// `agent_instance` row, the harness splices it into the prompt
/// verbatim. Empty / blank fields are dropped at render time so an
/// uninitialised wire payload (PR B's default) produces no model-facing
/// bytes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentIdentityWire {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub personality: String,
}

impl AgentIdentityWire {
    /// True when every field is blank — i.e. the wire payload carries
    /// no user-visible identity. PR B's default state for every aura-os
    /// caller (the producer leaves these unpopulated until PR C).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.name.trim().is_empty()
            && self.role.trim().is_empty()
            && self.personality.trim().is_empty()
    }
}
