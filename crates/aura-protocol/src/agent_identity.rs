//! Wire-compatible agent persona bundle.
//!
//! Mirror of `aura_harness::aura_protocol::AgentPersona`. The aura-os
//! producer side fills this in from the `agent_instance` row and ships
//! it on the [`crate::AgentIdentity`] envelope of a
//! [`crate::RuntimeRequest`]. The harness re-borrows it as
//! `aura_prompts::AgentIdentity<'_>` when assembling the assembled
//! system prompt's `<agent_identity>` section.
//!
//! Renamed from `AgentIdentityWire` to `AgentPersona` in Phase A of the
//! cross-repo gateway refactor to free up the `AgentIdentity` name for
//! the wider envelope struct that wraps persona + skills + system
//! prompt + template id + partition id.
//!
//! Lives in `aura-protocol` (rather than `aura-os-harness`) so any
//! future client-side caller (eval harness, OpenAPI generator, etc.)
//! can reach it from a stable location.

use serde::{Deserialize, Serialize};

#[cfg(feature = "typescript")]
use ts_rs::TS;

/// Free-form agent persona surfaced into the assembled system prompt's
/// `<agent_identity>` section.
///
/// Every field is best-effort prose: aura-os reads it off the
/// `agent_instance` row, the harness splices it into the prompt
/// verbatim. Empty / blank fields are dropped at render time so an
/// uninitialised wire payload produces no model-facing bytes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentPersona {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub personality: String,
}

impl AgentPersona {
    /// True when every field is blank — i.e. the wire payload carries
    /// no user-visible identity.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.name.trim().is_empty()
            && self.role.trim().is_empty()
            && self.personality.trim().is_empty()
    }
}
