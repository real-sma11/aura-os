use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::kind::ChannelKind;

/// A short-lived linking code minted while a user is connecting an
/// external chat to one of their agents.
///
/// Consumed exactly once (see [`crate::ChannelService::take_pending`]) and
/// rejected once `expires_at` has passed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingLink {
    pub code: String,
    pub user_id: String,
    pub access_token: String,
    pub agent_id: String,
    /// Display name of the agent being linked, captured at mint time so the
    /// bridge can greet the user with the agent's real name once the link is
    /// redeemed. Older pending records lack it — `#[serde(default)]` keeps
    /// wire compat and yields an empty string.
    #[serde(default)]
    pub agent_name: String,
    pub org_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

/// A durable binding between an external chat and an agent, established
/// once a [`PendingLink`] is redeemed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelLink {
    pub kind: ChannelKind,
    pub chat_id: String,
    pub user_id: String,
    pub access_token: String,
    pub agent_id: String,
    /// Display name of the linked agent, carried over from the redeemed
    /// [`PendingLink`]. Used to greet the user by the agent's real name.
    /// `#[serde(default)]` keeps durable links persisted before this field
    /// existed deserializable (defaulting to an empty string).
    #[serde(default)]
    pub agent_name: String,
    pub org_id: Option<String>,
    pub created_at: DateTime<Utc>,
    /// Set when the stored `access_token` is known to be stale so the UI
    /// can prompt the user to re-link without dropping the binding.
    pub needs_relink: bool,
}
