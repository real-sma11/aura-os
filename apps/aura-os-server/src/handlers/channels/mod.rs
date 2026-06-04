//! HTTP handlers for the external-chat (Telegram) bridge.
//!
//! Phase 4 surface:
//! - `POST /api/agents/:agent_id/channels/telegram/link` — mint a single-use
//!   linking code + Telegram deep link for a *remote* agent.
//! - `GET  /api/agents/:agent_id/channels` — list the agent's durable links.
//! - `DELETE /api/agents/:agent_id/channels/:channel_id` — drop a link.
//!
//! All three routes live in the authenticated group (so
//! `require_verified_session` runs ahead of them); the link handler captures
//! both the caller's access token and `user_id` into the [`PendingLink`] so the
//! bridge can later dispatch turns on the linking user's behalf.

use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;
use serde::Serialize;

use aura_os_channels::{ChannelKind, ChannelLink, PendingLink};
use aura_os_core::{AgentId, HarnessMode};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

/// Pending-link codes expire after this many minutes. Long enough for a
/// human to switch to Telegram and tap the deep link, short enough that a
/// leaked code is useless almost immediately.
const PENDING_LINK_TTL_MINUTES: i64 = 10;

/// Response for `POST .../channels/telegram/link`.
///
/// Phase 5 (frontend) depends on these exact field names.
#[derive(Debug, Serialize)]
pub(crate) struct TelegramLinkResponse {
    pub code: String,
    pub deep_link: String,
    pub bot_username: String,
}

/// One durable link, as surfaced by `GET .../channels`.
#[derive(Debug, Serialize)]
pub(crate) struct ChannelDto {
    /// Stable `"<kind>:<chat_id>"` handle the disconnect route consumes.
    pub channel_id: String,
    pub kind: ChannelKind,
    pub chat_id: String,
    /// `"connected"` or `"needs_relink"`.
    pub status: String,
    pub created_at: chrono::DateTime<Utc>,
}

/// Response for `GET .../channels`.
#[derive(Debug, Serialize)]
pub(crate) struct ListChannelsResponse {
    pub channels: Vec<ChannelDto>,
}

/// Response for `DELETE .../channels/:channel_id`.
#[derive(Debug, Serialize)]
pub(crate) struct DisconnectResponse {
    pub ok: bool,
}

/// Resolve the target agent with the caller's JWT, falling back to the local
/// shadow on a strict `NotFound`. Mirrors
/// `handlers::agents::chat::agent_route::resolve::resolve_agent_for_chat`
/// (which is private to that module) so the channel routes share the same
/// network-first, shadow-fallback resolution semantics.
async fn resolve_agent(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
) -> ApiResult<aura_os_core::Agent> {
    match state.agent_service.get_agent_with_jwt(jwt, agent_id).await {
        Ok(agent) => Ok(agent),
        Err(aura_os_agents::AgentError::NotFound) => {
            state.agent_service.get_agent_local(agent_id).map_err(|_| {
                ApiError::not_found(format!(
                    "agent {agent_id} not found in network or local shadow"
                ))
            })
        }
        Err(error) => Err(ApiError::internal(format!(
            "resolving agent {agent_id}: {error}"
        ))),
    }
}

/// `POST /api/agents/:agent_id/channels/telegram/link`
pub(crate) async fn link_telegram(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<TelegramLinkResponse>> {
    let agent = resolve_agent(&state, &agent_id, &jwt).await?;

    // Messaging connectors only make sense for remote (Swarm) agents: a
    // local agent's harness session is bound to the desktop process, so a
    // Telegram chat couldn't reach it. Mirror the swarm.rs remote-only guard.
    if HarnessMode::from_machine_type(&agent.machine_type) != HarnessMode::Swarm {
        return Err(ApiError::bad_request(
            "messaging connectors are only available for remote agents",
        ));
    }

    let bot_username = match state.telegram_bot_username.get() {
        Some(username) => username.clone(),
        None => {
            return Err(ApiError::service_unavailable(
                "Telegram bot is not configured",
            ))
        }
    };

    let code = uuid::Uuid::new_v4().simple().to_string();
    let now = Utc::now();
    let pending = PendingLink {
        code: code.clone(),
        user_id: auth_session.user_id.clone(),
        access_token: jwt.clone(),
        agent_id: agent_id.to_string(),
        org_id: agent.org_id.map(|org_id| org_id.to_string()),
        created_at: now,
        expires_at: now + chrono::Duration::minutes(PENDING_LINK_TTL_MINUTES),
    };

    state
        .channel_service
        .create_pending(&pending)
        .map_err(|error| ApiError::internal(format!("failed to store pending link: {error}")))?;

    let deep_link = format!("https://t.me/{bot_username}?start={code}");
    Ok(Json(TelegramLinkResponse {
        code,
        deep_link,
        bot_username,
    }))
}

/// `GET /api/agents/:agent_id/channels`
pub(crate) async fn list_channels(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<ListChannelsResponse>> {
    let links = state
        .channel_service
        .list_links_for_agent(&agent_id.to_string())
        .map_err(|error| ApiError::internal(format!("failed to list channels: {error}")))?;

    let channels = links
        .into_iter()
        .map(|link: ChannelLink| ChannelDto {
            channel_id: format!("{}:{}", link.kind.as_str(), link.chat_id),
            kind: link.kind,
            chat_id: link.chat_id,
            status: if link.needs_relink {
                "needs_relink".to_string()
            } else {
                "connected".to_string()
            },
            created_at: link.created_at,
        })
        .collect();

    Ok(Json(ListChannelsResponse { channels }))
}

/// `DELETE /api/agents/:agent_id/channels/:channel_id`
///
/// `channel_id` is the `"<kind>:<chat_id>"` handle returned by the list route.
pub(crate) async fn disconnect_channel(
    State(state): State<AppState>,
    Path((_agent_id, channel_id)): Path<(AgentId, String)>,
) -> ApiResult<Json<DisconnectResponse>> {
    let (kind_str, chat_id) = channel_id.split_once(':').ok_or_else(|| {
        ApiError::bad_request("channel_id must be in the form `<kind>:<chat_id>`")
    })?;

    let kind = match kind_str {
        "telegram" => ChannelKind::Telegram,
        other => {
            return Err(ApiError::bad_request(format!(
                "unsupported channel kind `{other}`"
            )))
        }
    };

    state
        .channel_service
        .delete_link(kind, chat_id)
        .map_err(|error| ApiError::internal(format!("failed to disconnect channel: {error}")))?;

    Ok(Json(DisconnectResponse { ok: true }))
}
