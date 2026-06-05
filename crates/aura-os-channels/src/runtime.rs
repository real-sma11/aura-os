use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;

use crate::connector::ChatConnector;
use crate::dispatcher::{DispatchOutcome, MessageDispatcher};
use crate::error::ChannelError;
use crate::inbound::{InboundHandler, InboundMessage};
use crate::kind::ChannelKind;
use crate::records::ChannelLink;
use crate::service::ChannelService;

/// Transport-agnostic glue between an inbound chat stream, the link store, and
/// the agent dispatcher.
///
/// Implements [`InboundHandler`] so any [`ChatConnector`] can drive it via
/// `connector.run(runtime)`. Responsibilities:
/// - redeem `/start <code>` linking codes into durable [`ChannelLink`]s,
/// - route normal messages to the linked agent through a [`MessageDispatcher`],
/// - guide unlinked / stale chats back through the linking flow.
pub struct BridgeRuntime {
    connector: Arc<dyn ChatConnector>,
    service: Arc<ChannelService>,
    dispatcher: Arc<dyn MessageDispatcher>,
    kind: ChannelKind,
    /// Generic "reconnect me" message shown to unlinked / stale chats. Phase 4
    /// will inject a real deep link; for now it's a plain injected string.
    reconnect_hint: String,
}

impl BridgeRuntime {
    pub fn new(
        connector: Arc<dyn ChatConnector>,
        service: Arc<ChannelService>,
        dispatcher: Arc<dyn MessageDispatcher>,
        kind: ChannelKind,
        reconnect_hint: String,
    ) -> Self {
        Self {
            connector,
            service,
            dispatcher,
            kind,
            reconnect_hint,
        }
    }

    /// Best-effort reply: log and swallow send failures so a transport hiccup
    /// never tears down the inbound loop.
    async fn reply(&self, chat_id: &str, text: &str) {
        if let Err(e) = self.connector.send_text(chat_id, text).await {
            tracing::warn!(error = %e, chat_id, "failed to send reply");
        }
    }

    /// Handle a `/start <code>` linking attempt.
    async fn handle_start(&self, chat_id: &str, code: &str) {
        match self.service.take_pending(code) {
            Ok(Some(pending)) => {
                let link = ChannelLink {
                    kind: self.kind,
                    chat_id: chat_id.to_string(),
                    user_id: pending.user_id,
                    access_token: pending.access_token,
                    agent_id: pending.agent_id,
                    agent_name: pending.agent_name,
                    org_id: pending.org_id,
                    created_at: Utc::now(),
                    needs_relink: false,
                };
                if let Err(e) = self.service.put_link(&link) {
                    tracing::error!(error = %e, chat_id, "failed to persist channel link");
                    self.reply(chat_id, "Sorry, something went wrong reaching your agent.")
                        .await;
                    return;
                }
                let connected = if link.agent_name.trim().is_empty() {
                    "Connected. You can now chat with your agent here.".to_string()
                } else {
                    format!("Connected to {}. You can now chat here.", link.agent_name)
                };
                self.reply(chat_id, &connected).await;
            }
            Ok(None) => {
                self.reply(
                    chat_id,
                    "That connection link is invalid or expired. Generate a new one in AURA.",
                )
                .await;
            }
            Err(e) => {
                tracing::error!(error = %e, chat_id, "failed to read pending link");
                self.reply(chat_id, "Sorry, something went wrong reaching your agent.")
                    .await;
            }
        }
    }

    /// Handle a normal (non-`/start`) message against an existing link.
    async fn handle_message(&self, chat_id: &str, text: &str) {
        let link = match self.service.get_link(self.kind, chat_id) {
            Ok(link) => link,
            Err(e) => {
                tracing::error!(error = %e, chat_id, "failed to load channel link");
                self.reply(chat_id, "Sorry, something went wrong reaching your agent.")
                    .await;
                return;
            }
        };

        let Some(link) = link else {
            self.reply(chat_id, &self.reconnect_hint).await;
            return;
        };

        if link.needs_relink {
            self.reply(chat_id, &self.reconnect_hint).await;
            return;
        }

        // Best-effort typing indicator.
        if let Err(e) = self.connector.send_typing(chat_id).await {
            tracing::debug!(error = %e, chat_id, "send_typing failed (ignored)");
        }

        match self.dispatcher.dispatch_to_agent(&link, text).await {
            Ok(DispatchOutcome::Reply(reply)) => {
                self.reply(chat_id, &reply).await;
            }
            Ok(DispatchOutcome::NeedsRelink) => {
                if let Err(e) = self.service.mark_needs_relink(self.kind, chat_id, true) {
                    tracing::error!(error = %e, chat_id, "failed to mark needs_relink");
                }
                self.reply(chat_id, &self.reconnect_hint).await;
            }
            Err(e) => {
                tracing::error!(error = %e, chat_id, "agent dispatch failed");
                // Surface agent-reported failures (e.g. harness errors) to the
                // user verbatim so they aren't left guessing; keep infra/store
                // transport errors behind the generic apology.
                let reply = match &e {
                    ChannelError::Agent(msg) => {
                        format!("Your agent ran into a problem:\n\n{msg}")
                    }
                    _ => "Sorry, something went wrong reaching your agent.".to_string(),
                };
                self.reply(chat_id, &reply).await;
            }
        }
    }
}

#[async_trait]
impl InboundHandler for BridgeRuntime {
    async fn on_message(&self, msg: InboundMessage) {
        let InboundMessage {
            chat_id,
            text,
            start_payload,
        } = msg;

        match start_payload {
            Some(code) if !code.is_empty() => {
                self.handle_start(&chat_id, &code).await;
            }
            _ => {
                self.handle_message(&chat_id, &text).await;
            }
        }
    }
}
