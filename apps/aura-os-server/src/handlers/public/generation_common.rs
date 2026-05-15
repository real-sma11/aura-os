//! Shared upstream-proxy plumbing for the public-mode generation
//! endpoints (image / video / model3d).
//!
//! The three handlers (`handlers/public/{image,video,model3d}.rs`)
//! all funnel through this single core so the rate-limit-gate +
//! upstream-call + SSE-shape concerns live in one place. Each
//! handler stays a thin orchestrator that:
//!
//! 1. Validates its own request body (DTO defines only the fields a
//!    public caller may send — everything else is hardcoded
//!    server-side per the plan's cost-control mandate).
//! 2. Reserves a turn slot via [`super::enforce_public_turn`].
//! 3. Calls [`proxy_public_generation_stream`] with the fixed
//!    upstream payload and modality.
//!
//! The upstream router (`aura-router /v1/generate-*/stream`)
//! returns SSE frames that the auth'd siblings already normalize
//! into the canonical event names the chat-ui renders
//! (`generation_start`, `generation_progress`,
//! `generation_partial_image`, `generation_completed`,
//! `generation_error`). The same normalization is reproduced here
//! so the frontend's existing media-rendering code works unchanged
//! for public users — we cannot reach into
//! `handlers/generation/`'s `pub(super)` helpers from this module
//! (and Phase 3 must not modify the auth'd generation files), so
//! the helpers are duplicated.

use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_core::Stream;
use futures_util::{stream, StreamExt};
use reqwest::StatusCode as ReqwestStatus;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::pin::Pin;
use tokio::time::timeout;
use tracing::{error, info, warn};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::demo_agent::SYSTEM_DEMO_USER_ID;
use super::gate::{emit_limit_frame, record_completion, TurnGuard};
use super::types::PublicModality;

/// Hard ceiling on the upstream POST connection. The auth'd image,
/// video, and model3d siblings rely on the harness
/// `event_idle_timeout` and `max_runtime` envs; for the direct-HTTP
/// public proxy we apply a single watchdog on the open call and let
/// the SSE relay drain on its own afterwards. Upstream emits a
/// terminal frame within its own max-runtime budget; otherwise the
/// dropped TCP connection terminates the stream.
const PUBLIC_GENERATION_OPEN_TIMEOUT: Duration = Duration::from_secs(120);

/// SSE response stream shape mirroring the auth'd `SseStream` (kept
/// inline so the public module does not depend on the auth'd
/// `generation/sse.rs` private alias). Re-exported as
/// [`PublicGenerationSse`] for handlers that need to spell the type
/// in their own return signature.
pub(crate) type PublicGenerationSse =
    Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send + 'static>>;

/// Bundle of fixed inputs for one public-mode generation call.
///
/// Caller-provided fields land in `payload` only after the handler
/// has stripped any client-overridable knob (`model`, `size`,
/// `duration`, `quality`) and substituted server-fixed defaults.
pub(crate) struct PublicGenerationCall {
    /// Upstream router path appended to `state.router_url`. Always a
    /// `/v1/generate-*/stream` SSE endpoint.
    pub(crate) upstream_path: &'static str,
    /// Hardcoded JSON body forwarded to the upstream proxy. Built
    /// fresh by the per-modality handler — never derived from the
    /// raw request body, so clients cannot override expensive
    /// parameters.
    pub(crate) payload: Value,
    /// Modality this call targets. Used purely for tracing fields.
    pub(crate) modality: PublicModality,
}

/// Authenticate + open the upstream proxy stream and wrap the
/// resulting byte stream as an SSE response. On stream completion
/// the canonical `{ kind: "limit", ... }` frame is appended so the
/// frontend mounts the upgrade modal deterministically — matching
/// the phase-2 chat handler's contract.
pub(crate) async fn proxy_public_generation_stream(
    state: &AppState,
    bearer_token: &str,
    call: PublicGenerationCall,
    guard: TurnGuard,
) -> ApiResult<Sse<PublicGenerationSse>> {
    let generation_id = uuid::Uuid::new_v4().to_string();
    let modality = call.modality;
    let url = format!("{}{}", state.router_url, call.upstream_path);
    info!(
        generation_id = %generation_id,
        modality = modality.as_str(),
        guest_id = %guard.guest_id,
        turn_count = guard.turn_count(),
        "public_generation: opening upstream proxy"
    );

    let client = reqwest::Client::new();
    let response = timeout(
        PUBLIC_GENERATION_OPEN_TIMEOUT,
        client
            .post(&url)
            .bearer_auth(bearer_token)
            .header("X-Aura-Agent-Id", format!("public-{}", &generation_id))
            .header("X-Aura-User-Id", SYSTEM_DEMO_USER_ID)
            .header("X-Aura-Session-Id", &generation_id)
            .json(&call.payload)
            .send(),
    )
    .await
    .map_err(|_| {
        warn!(
            generation_id = %generation_id,
            modality = modality.as_str(),
            "public_generation: upstream open timed out"
        );
        ApiError::service_unavailable("public generation is taking too long to start")
    })?
    .map_err(|err| {
        error!(
            generation_id = %generation_id,
            modality = modality.as_str(),
            error = %err,
            "public_generation: upstream request failed"
        );
        ApiError::bad_gateway(format!("upstream request failed: {err}"))
    })?;

    if !response.status().is_success() {
        return Err(map_upstream_status_failure(response).await);
    }

    let bytes = response.bytes_stream();
    let stream = build_public_generation_sse(bytes, generation_id, guard, modality);
    let boxed: PublicGenerationSse = Box::pin(stream);
    Ok(Sse::new(boxed).keep_alive(KeepAlive::default()))
}

/// Best-effort caller-IP extraction for the rate-limiter's per-IP
/// bucket. Reads `X-Forwarded-For` (first hop) and `X-Real-IP` in
/// that order; falls back to `127.0.0.1` when the server is reached
/// directly. The result is hashed via
/// [`super::types::IpHash::from_ip`] before it ever touches the
/// limiter map, so a "wrong" fallback can only undercount, never
/// leak the raw header.
pub(crate) fn caller_ip_from_headers(headers: &HeaderMap) -> IpAddr {
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

/// Best-effort bearer-token extraction from the request headers.
/// The guest JWT was already decoded by [`AuthGuestJwt`]; we
/// re-read the raw `Authorization` header here so the upstream
/// router proxy receives the same opaque string the caller sent.
/// Returns `None` when the header is absent or not `Bearer <token>`.
pub(crate) fn bearer_token_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|raw| raw.strip_prefix("Bearer "))
        .map(str::to_string)
}

/// Translate a non-2xx upstream response into the typed [`ApiError`]
/// shape the rest of the server uses.
async fn map_upstream_status_failure(response: reqwest::Response) -> (axum::http::StatusCode, axum::Json<crate::error::ApiError>) {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    error!(
        %status,
        body = %body,
        "public_generation: upstream returned error status"
    );
    match status {
        ReqwestStatus::UNAUTHORIZED => ApiError::unauthorized("router rejected token"),
        ReqwestStatus::PAYMENT_REQUIRED => ApiError::payment_required("insufficient credits"),
        ReqwestStatus::TOO_MANY_REQUESTS => ApiError::service_unavailable("rate limited"),
        _ => ApiError::bad_gateway(format!("upstream returned {status}: {body}")),
    }
}

/// Wire-shape of the per-frame state threaded through
/// [`stream::unfold`]. Owns the upstream byte stream, parse buffer,
/// and the [`TurnGuard`] that needs to be dropped via
/// [`record_completion`] once the stream terminates.
struct PublicGenerationStreamState<S> {
    bytes: Pin<Box<S>>,
    buffer: String,
    done: bool,
    emitted_limit: bool,
    generation_id: String,
    modality: PublicModality,
    guard: Option<TurnGuard>,
}

/// Build the per-call SSE stream: forward upstream frames (mapping
/// them to canonical event names so the frontend's renderer reuses
/// its auth'd code path), then append the terminal `limit` frame
/// and run [`record_completion`].
fn build_public_generation_sse<S>(
    bytes: S,
    generation_id: String,
    guard: TurnGuard,
    modality: PublicModality,
) -> impl Stream<Item = Result<Event, Infallible>> + Send
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    let turn_count = guard.turn_count();
    let initial = PublicGenerationStreamState {
        bytes: Box::pin(bytes),
        buffer: String::new(),
        done: false,
        emitted_limit: false,
        generation_id,
        modality,
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
            match state.bytes.next().await {
                Some(Ok(chunk)) => {
                    state.buffer.push_str(&String::from_utf8_lossy(&chunk));
                }
                Some(Err(err)) => {
                    error!(
                        generation_id = %state.generation_id,
                        modality = state.modality.as_str(),
                        error = %err,
                        "public_generation: upstream stream errored"
                    );
                    state.done = true;
                    return Some((
                        Ok(generation_error_event(
                            "UPSTREAM_STREAM_ERROR",
                            format!("public generation stream failed: {err}"),
                        )),
                        state,
                    ));
                }
                None => {
                    if let Some(frame) = take_trailing_frame(&mut state.buffer) {
                        if let Some(event) = router_frame_to_generation_event(&frame, state.modality) {
                            state.done = event.terminal;
                            return Some((Ok(event.event), state));
                        }
                    }
                    state.done = true;
                }
            }
        }
    })
}

/// Pull one `\n\n`-delimited frame off the buffer (if any) and map
/// it onto the canonical generation event. Returns `None` when the
/// buffer holds no full frame yet.
fn drain_buffered_frame<S>(state: &mut PublicGenerationStreamState<S>) -> Option<Result<Event, Infallible>> {
    while let Some(sep_pos) = state.buffer.find("\n\n") {
        let frame = state.buffer[..sep_pos].to_string();
        state.buffer = state.buffer[sep_pos + 2..].to_string();
        if frame.trim().is_empty() {
            continue;
        }
        if let Some(translated) = router_frame_to_generation_event(&frame, state.modality) {
            state.done = translated.terminal;
            return Some(Ok(translated.event));
        }
    }
    None
}

/// Drain any partial frame left after the upstream closes the
/// connection without a trailing `\n\n`.
fn take_trailing_frame(buffer: &mut String) -> Option<String> {
    let trimmed = buffer.trim();
    if trimmed.is_empty() {
        return None;
    }
    let frame = std::mem::take(buffer);
    Some(frame)
}

/// Translated upstream frame.
struct TranslatedFrame {
    event: Event,
    terminal: bool,
}

/// Parse a single SSE frame off the upstream byte stream and map it
/// onto the canonical generation event names the chat-ui knows how
/// to render. Anything we do not recognise is dropped so the wire
/// surface stays narrow.
fn router_frame_to_generation_event(frame: &str, modality: PublicModality) -> Option<TranslatedFrame> {
    let (event_type, data) = parse_sse_frame(frame);
    if data.trim() == "[DONE]" {
        return Some(TranslatedFrame {
            event: Event::default().event("done").data("{}"),
            terminal: true,
        });
    }
    let parsed: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
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
        "generation_start" | "start" | "started" => Some(TranslatedFrame {
            event: build_event("generation_start", &json!({ "mode": modality.as_str() })),
            terminal: false,
        }),
        "generation_progress" | "progress" => Some(TranslatedFrame {
            event: build_event("generation_progress", &parsed),
            terminal: false,
        }),
        "generation_partial_image" | "partial_image" | "partial" => Some(TranslatedFrame {
            event: build_event("generation_partial_image", &parsed),
            terminal: false,
        }),
        "generation_completed" | "completed" | "complete" => {
            let payload = normalize_completed_payload(modality, parsed);
            Some(TranslatedFrame {
                event: build_event("generation_completed", &payload),
                terminal: true,
            })
        }
        "generation_error" | "error" => Some(TranslatedFrame {
            event: build_event("generation_error", &normalize_error_payload(parsed)),
            terminal: true,
        }),
        "done" => Some(TranslatedFrame {
            event: Event::default().event("done").data("{}"),
            terminal: true,
        }),
        _ => None,
    }
}

/// Parse one SSE frame (`event:`/`data:` lines) into the canonical
/// `(event_type, data)` pair the rest of this module operates on.
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

/// Build an SSE [`Event`] for a typed JSON payload, falling back to
/// `{}` if serialization unexpectedly fails (only happens for cycles
/// — none of our payloads produce them).
fn build_event(event_name: &str, payload: &Value) -> Event {
    Event::default()
        .event(event_name)
        .json_data(payload)
        .unwrap_or_else(|_| Event::default().event(event_name).data("{}"))
}

/// Wrap a completed-payload normalization so the public surface
/// emits the same `{ imageUrl, originalUrl, artifactId, mode }`
/// shape the auth'd handlers do. The frontend chat-ui keys off the
/// `imageUrl` field for image / video / model3d alike (the same
/// alias the auth'd `normalize_generation_completed_payload` lands
/// on); duplicating the logic here avoids reaching into the
/// `pub(super)` auth'd helper.
fn normalize_completed_payload(modality: PublicModality, payload: Value) -> Value {
    let mut payload = match payload {
        Value::Object(_) => payload,
        other => {
            return json!({
                "mode": modality.as_str(),
                "payload": other,
            });
        }
    };
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("mode".to_string(), json!(modality.as_str()));
        let nested = obj
            .get("payload")
            .and_then(|value| value.as_object())
            .cloned();
        if !obj.contains_key("imageUrl") {
            if let Some(value) = first_string_field(
                obj,
                nested.as_ref(),
                &[
                    "imageUrl",
                    "image_url",
                    "assetUrl",
                    "asset_url",
                    "videoUrl",
                    "video_url",
                    "modelUrl",
                    "model_url",
                    "url",
                ],
            ) {
                obj.insert("imageUrl".to_string(), json!(value));
            }
        }
        if !obj.contains_key("originalUrl") {
            if let Some(value) = first_string_field(
                obj,
                nested.as_ref(),
                &["originalUrl", "original_url"],
            ) {
                obj.insert("originalUrl".to_string(), json!(value));
            }
        }
        if !obj.contains_key("artifactId") {
            if let Some(value) =
                first_string_field(obj, nested.as_ref(), &["artifactId", "artifact_id", "id"])
            {
                obj.insert("artifactId".to_string(), json!(value));
            }
        }
    }
    payload
}

/// Coerce an upstream error frame into the `{ code, message }`
/// shape the chat-ui renders. Falls back to a generic message if
/// the upstream omitted both fields.
fn normalize_error_payload(payload: Value) -> Value {
    let message = payload
        .get("message")
        .and_then(|value| value.as_str())
        .or_else(|| payload.get("error").and_then(|value| value.as_str()))
        .unwrap_or("public generation failed upstream.");
    let code = payload
        .get("code")
        .and_then(|value| value.as_str())
        .unwrap_or("GENERATION_FAILED");
    json!({
        "code": code,
        "message": message,
    })
}

/// Look up the first present `keys` entry on the object or its
/// nested `payload` sibling, returning the owned string value.
fn first_string_field(
    obj: &Map<String, Value>,
    nested: Option<&Map<String, Value>>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| obj.get(*key).and_then(|value| value.as_str()))
        .or_else(|| {
            nested.and_then(|nested| {
                keys.iter()
                    .find_map(|key| nested.get(*key).and_then(|value| value.as_str()))
            })
        })
        .map(str::to_string)
}

/// Construct a synthetic `generation_error` SSE event for failures
/// originating on this server (not the upstream router).
fn generation_error_event(code: &'static str, message: impl Into<String>) -> Event {
    Event::default()
        .event("generation_error")
        .json_data(json!({
            "code": code,
            "message": message.into(),
        }))
        .unwrap_or_else(|_| Event::default().event("generation_error").data("{}"))
}

/// Serialize the canonical `limit` frame into an SSE event,
/// matching the phase-2 chat handler shape.
fn limit_event(turn_count: u32) -> Result<Event, Infallible> {
    let frame: LimitFrameWire = emit_limit_frame_wire(turn_count);
    let evt = Event::default()
        .event("limit")
        .json_data(&frame)
        .unwrap_or_else(|_| {
            Event::default()
                .event("limit")
                .data(format!("{{\"kind\":\"limit\",\"turn_count\":{turn_count}}}"))
        });
    Ok(evt)
}

/// Compact local serializer for the limit frame. Matches the
/// phase-2 [`super::gate::LimitFrame`] wire shape exactly — kept
/// separate so this module does not depend on the
/// (`pub(crate)`-but-otherwise-internal) gate type's `Serialize`
/// derive bounds shifting later.
#[derive(Debug, Clone, Serialize)]
struct LimitFrameWire {
    kind: &'static str,
    turn_count: u32,
    limit: u32,
}

fn emit_limit_frame_wire(turn_count: u32) -> LimitFrameWire {
    let inner = emit_limit_frame(turn_count);
    LimitFrameWire {
        kind: inner.kind,
        turn_count: inner.turn_count,
        limit: inner.limit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_frame_extracts_event_and_data() {
        let (event, data) =
            parse_sse_frame("event: generation_progress\ndata: {\"percent\":42}\n");
        assert_eq!(event, "generation_progress");
        assert_eq!(data, "{\"percent\":42}");
    }

    #[test]
    fn router_frame_maps_completed_to_canonical_event() {
        let translated = router_frame_to_generation_event(
            "event: completed\ndata: {\"asset_url\":\"https://cdn.example.com/v.mp4\"}\n",
            PublicModality::Video,
        )
        .expect("recognised completed frame");
        assert!(translated.terminal);
    }

    #[test]
    fn normalize_completed_payload_promotes_alias_fields() {
        let payload = normalize_completed_payload(
            PublicModality::Image,
            json!({ "assetUrl": "https://cdn.example.com/a.png" }),
        );
        assert_eq!(payload["mode"], "image");
        assert_eq!(payload["imageUrl"], "https://cdn.example.com/a.png");
    }

    #[test]
    fn router_frame_drops_unknown_events() {
        assert!(router_frame_to_generation_event(
            "event: never_heard_of\ndata: {}",
            PublicModality::Model3d,
        )
        .is_none());
    }
}
