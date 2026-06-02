//! aura-os-channels
//!
//! Foundational chat-connector layer that lets users talk to their remote
//! agents from external messaging apps (Telegram first).
//!
//! Building blocks:
//! - [`ChannelKind`]: the supported external platforms.
//! - [`ChatConnector`]: the async transport contract.
//! - [`ChannelError`]: the crate's error type.
//! - [`PendingLink`] / [`ChannelLink`]: the persisted link records.
//! - [`ChannelService`]: persistence over `aura_os_store::SettingsStore`.
//!
//! Phase 2 adds the inbound seam ([`InboundMessage`] / [`InboundHandler`]),
//! the agent-dispatch seam ([`MessageDispatcher`] / [`DispatchOutcome`] with a
//! [`NoopDispatcher`] placeholder), the [`TelegramConnector`] transport, and
//! the transport-agnostic [`BridgeRuntime`]. Real agent dispatch + auth and
//! server/frontend wiring are delivered in later phases.

pub mod connector;
pub mod dispatcher;
pub mod error;
pub mod inbound;
pub mod kind;
pub mod records;
pub mod runtime;
pub mod service;
pub mod telegram;

pub use connector::ChatConnector;
pub use dispatcher::{DispatchOutcome, MessageDispatcher, NoopDispatcher};
pub use error::ChannelError;
pub use inbound::{build_inbound, parse_inbound, InboundHandler, InboundMessage};
pub use kind::ChannelKind;
pub use records::{ChannelLink, PendingLink};
pub use runtime::BridgeRuntime;
pub use service::{ChannelLinkRef, ChannelService, CHANNELS_CF};
pub use telegram::{split_message, TelegramConnector};
