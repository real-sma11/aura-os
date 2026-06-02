//! aura-os-channels
//!
//! Foundational chat-connector layer that lets users talk to their remote
//! agents from external messaging apps (Telegram first).
//!
//! Phase 1 scope is intentionally narrow — the building blocks only:
//! - [`ChannelKind`]: the supported external platforms.
//! - [`ChatConnector`]: the async transport contract (no implementors yet).
//! - [`ChannelError`]: the crate's error type.
//! - [`PendingLink`] / [`ChannelLink`]: the persisted link records.
//! - [`ChannelService`]: persistence over `aura_os_store::SettingsStore`.
//!
//! Telegram networking, the bridge runtime, server routes, and frontend
//! wiring are delivered in later phases.

pub mod connector;
pub mod error;
pub mod kind;
pub mod records;
pub mod service;

pub use connector::ChatConnector;
pub use error::ChannelError;
pub use kind::ChannelKind;
pub use records::{ChannelLink, PendingLink};
pub use service::{ChannelLinkRef, ChannelService, CHANNELS_CF};
