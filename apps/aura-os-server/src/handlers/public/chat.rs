//! `POST /api/public/chat/stream` — anonymous chat-mode SSE handler.
//!
//! The public chat surface streams the demo assistant's reply by
//! proxying **directly to aura-router's `/v1/messages`** endpoint —
//! the same router the public generation endpoints
//! (`handlers/public/{image,video,model3d}.rs`) already proxy to in
//! production.
//!
//! This deliberately does NOT go through the harness
//! (`HarnessMode::Local` / `POST /v1/run`). The production aura.ai
//! deployment is a single Render web service running only
//! `aura-os-server` with no bundled `aura-node` harness, so the old
//! harness-backed path always failed there with
//! "public demo agent failed to start a session". The router path,
//! by contrast, is reachable in every deployment (it is how the
//! public generation surface works) and needs no extra process.
//!
//! Concerns skipped vs. the auth'd chat surface:
//!
//! - No project / org / session storage: the client owns the
//!   transcript in `localStorage`; the server never writes it.
//! - No persistence preflight, no turn-slot mutex, no auto-fork,
//!   no tool execution — a public turn is a single stateless LLM
//!   round-trip with the demo system prompt + the client's local
//!   transcript replayed as conversation context.
//!
//! The turn-limit gate ([`super::enforce_public_turn`]) reserves the
//! slot *before* the upstream router call so failed downstream
//! invocations cannot let the same guest retry for free.

use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr};
use std::pin::Pin;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_core::Stream;
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{info, warn};

use crate::error::{ApiError, ApiResult};
use crate::handlers::plan_mode::{append_plan_mode_suffix, wrap_user_content_for_plan_mode};
use crate::state::{AppState, AuthGuestJwt};

use super::demo_agent::{
    public_demo_agent_id, PUBLIC_DEMO_MODEL, PUBLIC_DEMO_SYSTEM_PROMPT, SYSTEM_DEMO_USER_ID,
};
use super::gate::{
    emit_limit_frame, enforce_public_turn, record_completion, PublicGateCtx, TurnGuard,
};
use super::types::PublicModality;

/// Mode toggle for public chat. `Plan` appends the shared plan-mode
/// system-prompt suffix and wraps the user message, mirroring the
/// auth'd chat surface. Both modes resolve to a single `/v1/messages`
/// round-trip (the public surface exposes no tools).
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PublicChatMode {
    Code,
    Plan,
}

/// Single prior turn carried through from the client's localStorage
/// transcript so the router request can rebuild conversational
/// context for the otherwise stateless public turn.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PublicChatTurn {
    /// `user` or `assistant`. Anything else is dropped in
    /// [`history_to_messages`].
    pub role: String,
    pub content: String,
}

/// Request body for [`public_chat_stream`].
#[derive(Debug, Deserialize)]
pub(crate) struct PublicChatRequest {
    /// Client-issued session id (opaque to the server; persisted only
    /// in `localStorage["aura-public:state"]`). Forwarded as the
    /// `x-aura-session-id` attribution header and included in tracing
    /// so operators can correlate guest activity across turns.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Prior turns from the client's local transcript, replayed as the
    /// `messages` array so the demo reply is grounded in the same
    /// context the user sees.
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

/// Hard ceiling on the upstream `/v1/messages` open call (time to
/// receive response headers). A wedged or overloaded router can't
/// keep a public SSE connection pending forever.
const PUBLIC_CHAT_OPEN_TIMEOUT: Duration = Duration::from_secs(60);

/// Output-token ceiling for a public demo turn. The public surface is
/// a teaser, so keep replies short and the operator-funded spend low.
const PUBLIC_CHAT_MAX_TOKENS: u32 = 1024;

/// `POST /api/public/chat/stream`. Streams the public demo assistant's
/// reply via SSE (`text_delta` frames) and appends a final
/// `{kind:"limit", ...}` frame so the client can mount the upgrade
/// modal deterministically.
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
    let is_plan_mode = matches!(body.mode, PublicChatMode::Plan);
    info!(
        guest_id = %claims.guest_id(),
        session_id = body.session_id.as_deref().unwrap_or(""),
        mode = ?body.mode,
        turn_count,
        "public_chat: turn accepted"
    );

    let req_body = build_router_request_body(&body, is_plan_mode);
    let response = open_router_stream(&state, &body, req_body).await?;
    Ok(build_public_sse_response(response, guard))
}

/// Build the Anthropic-style `/v1/messages` request body. The model is
/// pinned to [`PUBLIC_DEMO_MODEL`] (the public surface has no
/// client-side picker and the router rejects an empty model name).
///
/// Plan mode appends the shared plan-mode rules to the demo system
/// prompt and wraps the user content with the shared preamble; code
/// mode sends the bare message.
fn build_router_request_body(body: &PublicChatRequest, is_plan_mode: bool) -> Value {
    let system_prompt = if is_plan_mode {
        append_plan_mode_suffix(PUBLIC_DEMO_SYSTEM_PROMPT)
    } else {
        PUBLIC_DEMO_SYSTEM_PROMPT.to_string()
    };
    let user_content = if is_plan_mode {
        wrap_user_content_for_plan_mode(&body.message)
    } else {
        body.message.clone()
    };
    let mut messages = history_to_messages(&body.history);
    messages.push(json!({ "role": "user", "content": user_content }));
    json!({
        "model": PUBLIC_DEMO_MODEL,
        "max_tokens": PUBLIC_CHAT_MAX_TOKENS,
        "stream": true,
        "system": [{ "type": "text", "text": system_prompt }],
        "messages": messages,
    })
}

/// Convert client-supplied transcript turns into the `/v1/messages`
/// `messages` array. Drops anything whose role isn't
/// `user`/`assistant` so a malformed payload can't smuggle an
/// unexpected role through.
fn history_to_messages(history: &[PublicChatTurn]) -> Vec<Value> {
    history
        .iter()
        .filter(|t| matches!(t.role.as_str(), "user" | "assistant"))
        .map(|t| json!({ "role": t.role, "content": t.content }))
        .collect()
}

/// Open the upstream `/v1/messages` stream, wrapped in a hard timeout
/// so a wedged router cannot keep a public SSE connection pending
/// forever. No `Authorization` header is sent: the router assigns
/// `user_id "public-guest"` with IP-based rate limiting for
/// unauthenticated requests (the same contract the public generation
/// endpoints rely on).
async fn open_router_stream(
    state: &AppState,
    body: &PublicChatRequest,
    req_body: Value,
) -> ApiResult<reqwest::Response> {
    let url = format!("{}/v1/messages", state.router_url);
    let session_id = body.session_id.as_deref().unwrap_or("public");
    let agent_id = public_demo_agent_id().to_string();
    let request = state
        .http_client
        .post(&url)
        .header("x-aura-user-id", SYSTEM_DEMO_USER_ID)
        .header("x-aura-session-id", session_id)
        .header("x-aura-agent-id", agent_id)
        .json(&req_body);

    let response = tokio::time::timeout(PUBLIC_CHAT_OPEN_TIMEOUT, request.send())
        .await
        .map_err(|_| {
            warn!("public_chat: router open timed out");
            ApiError::service_unavailable("public demo agent is taking too long to respond")
        })?
        .map_err(|err| {
            warn!(error = %err, "public_chat: router open failed");
            ApiError::bad_gateway("public demo agent failed to start a session")
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        warn!(%status, body = %body_text, "public_chat: router returned error status");
        return Err(ApiError::bad_gateway(
            "public demo agent failed to start a session",
        ));
    }
    Ok(response)
}

/// Concrete SSE stream type fed into [`Sse::new`]. Boxed because the
/// concrete combinator chain is unnameable.
pub(crate) type PublicSseStream =
    std::pin::Pin<Box<dyn futures_core::Stream<Item = Result<Event, Infallible>> + Send + 'static>>;

/// Build the SSE response: translate the router's Anthropic message
/// stream into `text_delta` frames, then append the canonical
/// `{kind:"limit"}` frame so the frontend can mount the upgrade modal
/// even when the request itself succeeds.
fn build_public_sse_response(
    response: reqwest::Response,
    guard: TurnGuard,
) -> Sse<PublicSseStream> {
    let body_stream = build_public_chat_sse(response.bytes_stream(), guard);
    let combined: PublicSseStream = Box::pin(body_stream);
    Sse::new(combined).keep_alive(KeepAlive::default())
}

/// Per-frame state threaded through [`stream::unfold`]. Owns the
/// upstream byte stream, parse buffer, and the [`TurnGuard`] dropped
/// via [`record_completion`] once the stream terminates.
struct ChatStreamState<S> {
    bytes: Pin<Box<S>>,
    buffer: String,
    done: bool,
    emitted_limit: bool,
    guard: Option<TurnGuard>,
}

/// Drain the upstream `/v1/messages` SSE byte stream, forwarding each
/// text delta as a `text_delta` event, then append the terminal
/// `limit` frame and run [`record_completion`].
fn build_public_chat_sse<S>(
    bytes: S,
    guard: TurnGuard,
) -> impl Stream<Item = Result<Event, Infallible>> + Send
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    let turn_count = guard.turn_count();
    let initial = ChatStreamState {
        bytes: Box::pin(bytes),
        buffer: String::new(),
        done: false,
        emitted_limit: false,
        guard: Some(guard),
    };
    stream::unfold(initial, move |mut state| async move {
        if state.done && state.emitted_limit {
            return None;
        }
        loop {
            if state.done && !state.emitted_limit {
                state.emitted_limit = true;
                if let Some(guard) = state.guard.take() {
                    record_completion(guard);
                }
                return Some((limit_event(turn_count), state));
            }
            if let Some(event) = drain_buffered_frame(&mut state) {
                return Some((event, state));
            }
            // A terminal frame (message_stop / [DONE]) may have set
            // `done` without producing an event — loop back so the
            // top-of-loop branch emits the trailing `limit` frame
            // instead of blocking on another upstream read.
            if state.done {
                continue;
            }
            match state.bytes.next().await {
                Some(Ok(chunk)) => {
                    state.buffer.push_str(&String::from_utf8_lossy(&chunk));
                }
                Some(Err(err)) => {
                    warn!(error = %err, "public_chat: upstream stream errored");
                    state.done = true;
                    return Some((
                        Ok(chat_error_event(
                            "UPSTREAM_STREAM_ERROR",
                            format!("public chat stream failed: {err}"),
                        )),
                        state,
                    ));
                }
                None => {
                    state.done = true;
                }
            }
        }
    })
}

/// Pull complete `\n\n`-delimited frames off the buffer, returning the
/// first one that translates to a wire event. Terminal frames set
/// `state.done`; non-event frames (`ping`, `message_start`, etc.) are
/// skipped.
fn drain_buffered_frame<S>(state: &mut ChatStreamState<S>) -> Option<Result<Event, Infallible>> {
    while let Some(sep_pos) = state.buffer.find("\n\n") {
        let frame = state.buffer[..sep_pos].to_string();
        state.buffer = state.buffer[sep_pos + 2..].to_string();
        if frame.trim().is_empty() {
            continue;
        }
        if let Some(translated) = router_frame_to_chat_event(&frame) {
            if translated.terminal {
                state.done = true;
            }
            if let Some(event) = translated.event {
                return Some(Ok(event));
            }
            if state.done {
                return None;
            }
        }
    }
    None
}

/// Translated upstream frame: an optional wire event plus whether this
/// frame terminates the stream.
struct ChatFrame {
    event: Option<Event>,
    terminal: bool,
}

/// Map one Anthropic `/v1/messages` SSE frame onto the public chat
/// wire surface. Only text deltas, the terminal `message_stop`, and
/// errors are meaningful; everything else (`ping`, `message_start`,
/// `content_block_start/stop`, `message_delta`) is dropped.
fn router_frame_to_chat_event(frame: &str) -> Option<ChatFrame> {
    let (event_type, data) = parse_sse_frame(frame);
    if data.trim() == "[DONE]" {
        return Some(ChatFrame {
            event: None,
            terminal: true,
        });
    }
    let parsed: Value = serde_json::from_str(&data).ok()?;
    let tagged_type = parsed
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let effective_type = if event_type.is_empty() {
        tagged_type
    } else {
        event_type.as_str()
    };
    match effective_type {
        "content_block_delta" => {
            let text = parsed
                .get("delta")
                .filter(|d| d.get("type").and_then(|v| v.as_str()) == Some("text_delta"))
                .and_then(|d| d.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or_default();
            if text.is_empty() {
                Some(ChatFrame {
                    event: None,
                    terminal: false,
                })
            } else {
                Some(ChatFrame {
                    event: Some(text_delta_event(text)),
                    terminal: false,
                })
            }
        }
        "message_stop" => Some(ChatFrame {
            event: None,
            terminal: true,
        }),
        "error" => {
            let message = parsed
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("public chat upstream error");
            Some(ChatFrame {
                event: Some(chat_error_event("UPSTREAM_ERROR", message.to_string())),
                terminal: true,
            })
        }
        _ => Some(ChatFrame {
            event: None,
            terminal: false,
        }),
    }
}

/// Parse one SSE frame (`event:` / `data:` lines) into the canonical
/// `(event_type, data)` pair.
fn parse_sse_frame(frame: &str) -> (String, String) {
    let mut event_type = String::new();
    let mut data_lines: Vec<String> = Vec::new();
    for line in frame.lines() {
        if let Some(rest) = line.strip_prefix("event:") {
            event_type = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start().to_string());
        }
    }
    (event_type, data_lines.join("\n"))
}

/// Build a `text_delta` SSE event carrying one chunk of assistant
/// text. Matches the frontend's `isTextDeltaFrame` shape (`{ text }`).
fn text_delta_event(text: &str) -> Event {
    Event::default()
        .event("text_delta")
        .json_data(json!({ "text": text }))
        .unwrap_or_else(|_| Event::default().event("text_delta").data("{}"))
}

/// Build an `error` SSE event the frontend's `isErrorFrame` handler
/// understands (`{ code, message }`).
fn chat_error_event(code: &'static str, message: impl Into<String>) -> Event {
    Event::default()
        .event("error")
        .json_data(json!({ "code": code, "message": message.into() }))
        .unwrap_or_else(|_| Event::default().event("error").data("{}"))
}

/// Serialize the canonical `limit` frame into an SSE event.
fn limit_event(turn_count: u32) -> Result<Event, Infallible> {
    let frame = emit_limit_frame(turn_count);
    let event = Event::default()
        .event("limit")
        .json_data(&frame)
        .unwrap_or_else(|_| {
            Event::default().event("limit").data(format!(
                "{{\"kind\":\"limit\",\"turn_count\":{turn_count}}}"
            ))
        });
    Ok(event)
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
    fn history_to_messages_filters_unknown_roles() {
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
        let messages = history_to_messages(&history);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");
    }

    #[test]
    fn history_to_messages_empty_is_empty() {
        assert!(history_to_messages(&[]).is_empty());
    }

    #[test]
    fn code_mode_request_pins_model_and_streams() {
        let body = PublicChatRequest {
            session_id: None,
            history: vec![],
            message: "hello there".to_string(),
            mode: PublicChatMode::Code,
        };
        let req = build_router_request_body(&body, /* is_plan_mode */ false);
        assert_eq!(req["model"], PUBLIC_DEMO_MODEL);
        assert_eq!(req["stream"], true);
        let system = req["system"][0]["text"].as_str().expect("system text");
        assert_eq!(system, PUBLIC_DEMO_SYSTEM_PROMPT);
        let messages = req["messages"].as_array().expect("messages array");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "hello there");
    }

    #[test]
    fn plan_mode_request_suffixes_prompt_and_wraps_user_content() {
        let body = PublicChatRequest {
            session_id: None,
            history: vec![],
            message: "design a thing".to_string(),
            mode: PublicChatMode::Plan,
        };
        let req = build_router_request_body(&body, /* is_plan_mode */ true);
        assert_eq!(req["model"], PUBLIC_DEMO_MODEL);
        let system = req["system"][0]["text"].as_str().expect("system text");
        assert!(system.starts_with(PUBLIC_DEMO_SYSTEM_PROMPT));
        assert!(
            system.contains("PLAN MODE"),
            "plan-mode suffix must be appended, got: {system}"
        );
        let messages = req["messages"].as_array().expect("messages array");
        let user_content = messages
            .last()
            .and_then(|m| m["content"].as_str())
            .expect("user content");
        assert!(
            user_content.contains("design a thing"),
            "wrapped user content must still carry the message"
        );
    }

    #[test]
    fn router_frame_extracts_text_delta() {
        let frame = "event: content_block_delta\n\
                     data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}";
        let translated = router_frame_to_chat_event(frame).expect("recognised delta");
        assert!(!translated.terminal);
        let event = translated.event.expect("text_delta event");
        let dbg = format!("{event:?}");
        assert!(dbg.contains("text_delta"), "event name: {dbg}");
        assert!(dbg.contains("Hello"), "delta text: {dbg}");
    }

    #[test]
    fn router_frame_skips_non_text_deltas() {
        let frame = "event: content_block_delta\n\
                     data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}";
        let translated = router_frame_to_chat_event(frame).expect("frame recognised");
        assert!(!translated.terminal);
        assert!(translated.event.is_none(), "non-text delta must not emit");
    }

    #[test]
    fn router_frame_message_stop_is_terminal_without_event() {
        let frame = "event: message_stop\ndata: {\"type\":\"message_stop\"}";
        let translated = router_frame_to_chat_event(frame).expect("recognised stop");
        assert!(translated.terminal);
        assert!(translated.event.is_none());
    }

    #[test]
    fn router_frame_done_sentinel_is_terminal() {
        let translated =
            router_frame_to_chat_event("data: [DONE]").expect("[DONE] must map to terminal frame");
        assert!(translated.terminal);
        assert!(translated.event.is_none());
    }

    #[test]
    fn router_frame_error_is_terminal_with_event() {
        let frame = "event: error\n\
                     data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"slow down\"}}";
        let translated = router_frame_to_chat_event(frame).expect("recognised error");
        assert!(translated.terminal);
        let event = translated.event.expect("error event");
        let dbg = format!("{event:?}");
        assert!(dbg.contains("slow down"), "error message: {dbg}");
    }

    #[test]
    fn parse_sse_frame_extracts_event_and_data() {
        let (event, data) = parse_sse_frame("event: content_block_delta\ndata: {\"x\":1}\n");
        assert_eq!(event, "content_block_delta");
        assert_eq!(data, "{\"x\":1}");
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
