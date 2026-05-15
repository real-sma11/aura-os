//! `POST /api/public/chat/stream` — anonymous chat-mode SSE handler.
//!
//! Phase 2 of the public-mode plan. Mirrors the auth'd
//! `/api/agents/:id/chat/stream` shape for the surface visible to the
//! caller (SSE with the same event names so the frontend bridge code
//! can stay shared) but skips every concern that exists only for
//! signed-in users:
//!
//! - No project / org / session storage: the client owns the
//!   transcript in `localStorage`; the server never writes it.
//! - No persistence preflight, no turn-slot mutex, no auto-fork,
//!   no cross-agent reply hooks — the public surface targets the
//!   stable system-owned demo agent and runs each turn on a fresh
//!   harness session.
//!
//! The turn-limit gate ([`super::enforce_public_turn`]) reserves the
//! slot *before* the upstream harness call so failed downstream
//! invocations cannot let the same guest retry for free.

use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::stream::{self, StreamExt as FuturesStreamExt};
use serde::Deserialize;
use tracing::{info, warn};

use aura_os_core::AgentId;
use aura_os_harness::{
    ConversationMessage, HarnessOutbound, SessionBridge, SessionBridgeTurn, SessionConfig,
};

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::harness_broadcast_to_sse;
use crate::state::{AppState, AuthGuestJwt};

use super::demo_agent::{ensure_public_demo_agent, PUBLIC_DEMO_SYSTEM_PROMPT, SYSTEM_DEMO_USER_ID};
use super::gate::{
    emit_limit_frame, enforce_public_turn, record_completion, PublicGateCtx, TurnGuard,
};
use super::types::PublicModality;

/// Mode toggle for public chat. `Plan` maps to the harness
/// `generate_specs` action mirroring the auth'd chat surface.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PublicChatMode {
    Code,
    Plan,
}

/// Single prior turn carried through from the client's localStorage
/// transcript so the harness can rebuild conversational context on
/// the fresh session it opens for each public turn.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PublicChatTurn {
    /// `user` or `assistant`. Validated against [`ConversationMessage::role`]
    /// downstream — anything else is dropped in [`history_to_conversation`].
    pub role: String,
    pub content: String,
}

/// Request body for [`public_chat_stream`].
#[derive(Debug, Deserialize)]
pub(crate) struct PublicChatRequest {
    /// Client-issued session id (opaque to the server; persisted only
    /// in `localStorage["aura-public:state"]`). Included in tracing
    /// fields so operators can correlate guest activity across turns
    /// without needing the raw token.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Prior turns from the client's local transcript. Mapped onto
    /// the harness `SessionConfig.conversation_messages` so the demo
    /// agent's reply is grounded in the same context the user sees.
    #[serde(default)]
    pub history: Vec<PublicChatTurn>,
    /// New user message for this turn.
    pub message: String,
    /// Code vs. Plan mode toggle.
    #[serde(default = "default_mode")]
    pub mode: PublicChatMode,
}

fn default_mode() -> PublicChatMode {
    PublicChatMode::Code
}

/// Hard ceiling on the upstream `open_and_send_user_message` call.
/// Mirrors the auth'd chat handler's first-event-watchdog window so
/// a wedged harness can't keep a public SSE connection open forever.
const PUBLIC_CHAT_OPEN_TIMEOUT: Duration = Duration::from_secs(120);

/// `POST /api/public/chat/stream`. Streams the public demo agent's
/// reply via SSE and appends a final `{kind:"limit", ...}` frame so
/// the client can mount the upgrade modal deterministically.
pub(crate) async fn public_chat_stream(
    State(state): State<AppState>,
    AuthGuestJwt(claims): AuthGuestJwt,
    headers: HeaderMap,
    Json(body): Json<PublicChatRequest>,
) -> ApiResult<axum::response::sse::Sse<PublicSseStream>> {
    let ip = caller_ip_from_headers(&headers);
    let guard = enforce_public_turn(&PublicGateCtx {
        state: &state,
        claims: &claims,
        ip,
        modality: PublicModality::Chat,
    })?;
    let turn_count = guard.turn_count();
    info!(
        guest_id = %claims.guest_id(),
        session_id = body.session_id.as_deref().unwrap_or(""),
        mode = ?body.mode,
        turn_count,
        "public_chat: turn accepted"
    );

    let agent_id = ensure_public_demo_agent(&state).await.map_err(|err| {
        warn!(error = %err, "public_chat: demo agent provisioning failed");
        ApiError::service_unavailable("public demo agent unavailable")
    })?;
    let action = action_for_mode(body.mode);
    let config = build_public_session_config(agent_id, &body, action);
    let stream = open_public_stream(&state, config, body.message).await?;
    Ok(build_public_sse_response(stream, guard))
}

/// Map a [`PublicChatMode`] onto the harness action string. Plan
/// mode uses `generate_specs`, mirroring the auth'd chat surface.
fn action_for_mode(mode: PublicChatMode) -> Option<&'static str> {
    match mode {
        PublicChatMode::Code => None,
        PublicChatMode::Plan => Some("generate_specs"),
    }
}

/// Construct the minimal [`SessionConfig`] the public demo agent
/// runs each turn on. No project bindings, no real user id, no
/// installed integrations — the demo agent has full access via
/// [`aura_os_core::AgentPermissions::full_access`] but the session
/// scope is intentionally tiny.
fn build_public_session_config(
    agent_id: AgentId,
    body: &PublicChatRequest,
    action: Option<&'static str>,
) -> SessionConfig {
    let partition_agent_id = aura_os_core::harness_agent_id(&agent_id, None);
    let conversation_messages = history_to_conversation(&body.history);
    let max_turns = action.map(|_| 12u32);
    SessionConfig {
        system_prompt: Some(PUBLIC_DEMO_SYSTEM_PROMPT.to_string()),
        agent_id: Some(partition_agent_id),
        template_agent_id: Some(agent_id.to_string()),
        user_id: Some(SYSTEM_DEMO_USER_ID.to_string()),
        agent_name: Some("AURA Public Demo".to_string()),
        conversation_messages,
        max_turns,
        ..Default::default()
    }
}

/// Convert client-supplied transcript turns into the harness wire
/// shape. Drops anything whose role isn't `user`/`assistant` so a
/// malformed payload can't smuggle an unexpected role through.
fn history_to_conversation(history: &[PublicChatTurn]) -> Option<Vec<ConversationMessage>> {
    let messages: Vec<ConversationMessage> = history
        .iter()
        .filter(|t| matches!(t.role.as_str(), "user" | "assistant"))
        .map(|t| ConversationMessage {
            role: t.role.clone(),
            content: t.content.clone(),
        })
        .collect();
    if messages.is_empty() {
        None
    } else {
        Some(messages)
    }
}

/// Open the upstream harness session and forward the first user
/// turn, wrapped in a hard timeout so a wedged harness cannot keep a
/// public SSE connection open indefinitely.
async fn open_public_stream(
    state: &AppState,
    config: SessionConfig,
    user_content: String,
) -> ApiResult<tokio::sync::broadcast::Receiver<HarnessOutbound>> {
    let harness = state.harness_for(aura_os_core::HarnessMode::Local);
    let turn = SessionBridgeTurn {
        content: user_content,
        tool_hints: None,
        attachments: None,
    };
    let opened = tokio::time::timeout(
        PUBLIC_CHAT_OPEN_TIMEOUT,
        SessionBridge::open_and_send_user_message(harness, config, turn),
    )
    .await
    .map_err(|_| {
        warn!("public_chat: harness open timed out");
        ApiError::service_unavailable("public demo agent is taking too long to respond")
    })?
    .map_err(|err| {
        warn!(error = %err, "public_chat: harness open failed");
        ApiError::bad_gateway("public demo agent failed to start a session")
    })?;
    Ok(opened.events_rx)
}

/// Concrete SSE stream type fed into [`Sse::new`]. Boxed because the
/// concrete combinator chain is unnameable.
pub(crate) type PublicSseStream =
    std::pin::Pin<Box<dyn futures_core::Stream<Item = Result<Event, Infallible>> + Send + 'static>>;

/// Build the SSE response: forward the harness broadcast to the wire,
/// then append the canonical `{kind:"limit"}` frame so the frontend
/// can mount the upgrade modal even when the request itself succeeds.
fn build_public_sse_response(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    guard: TurnGuard,
) -> Sse<PublicSseStream> {
    let turn_count = guard.turn_count();
    let body_stream = harness_broadcast_to_sse(rx, None);
    let limit_frame = emit_limit_frame(turn_count);
    let limit_event = match Event::default().event("limit").json_data(&limit_frame) {
        Ok(evt) => Ok(evt),
        Err(_) => Ok(Event::default().event("limit").data(format!(
            "{{\"kind\":\"limit\",\"turn_count\":{turn_count}}}"
        ))),
    };
    let tail = stream::once(async move {
        record_completion(guard);
        limit_event
    });
    let combined: PublicSseStream = Box::pin(FuturesStreamExt::chain(body_stream, tail));
    Sse::new(combined).keep_alive(KeepAlive::default())
}

/// Best-effort caller-IP extraction for the rate-limiter's per-IP
/// bucket. Reads `X-Forwarded-For` (first hop) and `X-Real-IP` in
/// that order; falls back to `127.0.0.1` when the server is reached
/// directly (development / loopback). The result is hashed via
/// [`super::types::IpHash::from_ip`] before it ever touches the
/// limiter map, so a "wrong" fallback can only undercount, never
/// leak the raw header.
fn caller_ip_from_headers(headers: &HeaderMap) -> IpAddr {
    if let Some(forwarded) = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(ip) = forwarded.parse::<IpAddr>() {
            return ip;
        }
    }
    if let Some(real) = headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(ip) = real.parse::<IpAddr>() {
            return ip;
        }
    }
    IpAddr::V4(Ipv4Addr::LOCALHOST)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn action_for_mode_maps_plan_to_generate_specs() {
        assert_eq!(
            action_for_mode(PublicChatMode::Plan),
            Some("generate_specs")
        );
        assert_eq!(action_for_mode(PublicChatMode::Code), None);
    }

    #[test]
    fn history_to_conversation_filters_unknown_roles() {
        let history = vec![
            PublicChatTurn {
                role: "user".to_string(),
                content: "hi".to_string(),
            },
            PublicChatTurn {
                role: "tool".to_string(),
                content: "drop me".to_string(),
            },
            PublicChatTurn {
                role: "assistant".to_string(),
                content: "ok".to_string(),
            },
        ];
        let convo = history_to_conversation(&history).expect("kept user + assistant turns");
        assert_eq!(convo.len(), 2);
        assert_eq!(convo[0].role, "user");
        assert_eq!(convo[1].role, "assistant");
    }

    #[test]
    fn history_to_conversation_returns_none_on_empty() {
        assert!(history_to_conversation(&[]).is_none());
        let only_unknown = vec![PublicChatTurn {
            role: "system".to_string(),
            content: "x".to_string(),
        }];
        assert!(history_to_conversation(&only_unknown).is_none());
    }

    #[test]
    fn caller_ip_falls_back_to_localhost() {
        let headers = HeaderMap::new();
        assert_eq!(
            caller_ip_from_headers(&headers),
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        );
    }

    #[test]
    fn caller_ip_prefers_first_forwarded_hop() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.7, 198.51.100.1"),
        );
        let ip = caller_ip_from_headers(&headers);
        assert_eq!(ip.to_string(), "203.0.113.7");
    }
}
