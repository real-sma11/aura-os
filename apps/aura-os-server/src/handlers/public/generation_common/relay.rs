//! SSE relay state machine. Drains the upstream byte stream into
//! the canonical `generation_*` events the chat-ui already knows
//! how to render, then appends the trailing `{ kind: "limit", ... }`
//! frame so the frontend's upgrade modal mounts deterministically.

use std::convert::Infallible;
use std::pin::Pin;

use axum::body::Bytes;
use axum::response::sse::Event;
use futures_core::Stream;
use futures_util::{stream, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tracing::error;

use super::super::gate::{emit_limit_frame, record_completion, TurnGuard};
use super::super::types::PublicModality;
use super::completed::{normalize_completed_payload, normalize_error_payload};

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
pub(crate) fn build_public_generation_sse<S>(
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
                        if let Some(event) =
                            router_frame_to_generation_event(&frame, state.modality)
                        {
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
fn drain_buffered_frame<S>(
    state: &mut PublicGenerationStreamState<S>,
) -> Option<Result<Event, Infallible>> {
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
fn router_frame_to_generation_event(
    frame: &str,
    modality: PublicModality,
) -> Option<TranslatedFrame> {
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
            Event::default().event("limit").data(format!(
                "{{\"kind\":\"limit\",\"turn_count\":{turn_count}}}"
            ))
        });
    Ok(evt)
}

/// Compact local serializer for the limit frame. Matches the
/// phase-2 [`super::super::gate::LimitFrame`] wire shape exactly —
/// kept separate so this module does not depend on the
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
        let (event, data) = parse_sse_frame("event: generation_progress\ndata: {\"percent\":42}\n");
        assert_eq!(event, "generation_progress");
        assert_eq!(data, "{\"percent\":42}");
    }

    #[test]
    fn parse_sse_frame_joins_multiline_data() {
        let (event, data) = parse_sse_frame("event: chunk\ndata: line1\ndata: line2\n");
        assert_eq!(event, "chunk");
        assert_eq!(data, "line1\nline2");
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
    fn router_frame_drops_unknown_events() {
        assert!(router_frame_to_generation_event(
            "event: never_heard_of\ndata: {}",
            PublicModality::Model3d,
        )
        .is_none());
    }

    #[test]
    fn router_frame_treats_done_sentinel_as_terminal() {
        let translated = router_frame_to_generation_event("data: [DONE]", PublicModality::Image)
            .expect("[DONE] sentinel must map to terminal frame");
        assert!(translated.terminal);
    }

    #[test]
    fn router_frame_uses_payload_type_when_event_header_absent() {
        let translated = router_frame_to_generation_event(
            "data: {\"type\":\"progress\",\"percent\":12}",
            PublicModality::Image,
        )
        .expect("type-tagged progress frame must be recognised");
        assert!(!translated.terminal);
    }

    #[test]
    fn limit_frame_wire_carries_turn_count_and_limit() {
        let wire = emit_limit_frame_wire(2);
        assert_eq!(wire.turn_count, 2);
        assert_eq!(wire.kind, "limit");
        assert!(wire.limit >= 1);
    }
}
