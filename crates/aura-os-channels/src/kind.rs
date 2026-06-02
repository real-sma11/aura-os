use serde::{Deserialize, Serialize};

/// The external messaging platform a [`crate::ChannelLink`] is bound to.
///
/// `Telegram` is the only kind wired up in early phases; the remaining
/// variants reserve the namespace (and the on-disk storage-key segment
/// produced by [`ChannelKind::as_str`]) for future connectors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    Telegram,
    Signal,
    WhatsApp,
    Slack,
    Discord,
}

impl ChannelKind {
    /// Stable lowercase identifier used as a storage-key segment.
    ///
    /// This MUST stay in sync with the `snake_case` serde rename so the
    /// key segment and the serialized record agree.
    pub fn as_str(&self) -> &'static str {
        match self {
            ChannelKind::Telegram => "telegram",
            ChannelKind::Signal => "signal",
            ChannelKind::WhatsApp => "whatsapp",
            ChannelKind::Slack => "slack",
            ChannelKind::Discord => "discord",
        }
    }
}
