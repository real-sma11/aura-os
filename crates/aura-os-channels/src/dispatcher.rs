use async_trait::async_trait;

use crate::error::ChannelError;
use crate::records::ChannelLink;

/// The result of dispatching a user's message to their linked agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchOutcome {
    /// The agent produced a textual reply to relay back to the chat.
    Reply(String),
    /// The stored credentials are no longer usable; the link should be
    /// flagged so the user is prompted to reconnect.
    NeedsRelink,
}

/// Seam between the transport-agnostic bridge runtime and the actual agent
/// backend.
///
/// Phase 2 only defines the contract and ships a [`NoopDispatcher`]; the real
/// implementation (HTTP-to-server + auth) lands in a later phase.
#[async_trait]
pub trait MessageDispatcher: Send + Sync {
    /// Forward `user_text` to the agent bound by `link` and await its reply.
    async fn dispatch_to_agent(
        &self,
        link: &ChannelLink,
        user_text: &str,
    ) -> Result<DispatchOutcome, ChannelError>;
}

/// Placeholder dispatcher used until real agent wiring exists.
///
/// Always replies with a fixed notice so the crate compiles and the bridge
/// runtime is exercisable end-to-end in tests.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopDispatcher;

#[async_trait]
impl MessageDispatcher for NoopDispatcher {
    async fn dispatch_to_agent(
        &self,
        _link: &ChannelLink,
        _user_text: &str,
    ) -> Result<DispatchOutcome, ChannelError> {
        Ok(DispatchOutcome::Reply(
            "(agent dispatch not yet wired)".into(),
        ))
    }
}
