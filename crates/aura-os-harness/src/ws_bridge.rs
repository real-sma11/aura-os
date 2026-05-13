//! Bridge between the harness WebSocket and the in-process broadcast
//! channels used by aura-os-server. The broadcast capacity for both
//! outbound (typed) and raw harness events is controlled by
//! `AURA_HARNESS_BROADCAST_CAPACITY` (default
//! [`DEFAULT_BROADCAST_CAPACITY`]). Raising it reduces the chance
//! that a slow SSE consumer falls behind on tool-heavy turns and
//! triggers a `broadcast::RecvError::Lagged` — which Phase 1.2 of
//! the agent-stream reliability plan now surfaces as a
//! `progress: lagged` SSE hint rather than a terminal error, but is
//! still preferable to avoid entirely on heavy turns.

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{debug, warn};

use aura_protocol::{ErrorMsg, InboundMessage, OutboundMessage};

use crate::stability_metrics;

const WS_COMMAND_BUFFER: usize = 1024;
const WS_DEBUG_PAYLOAD_LIMIT: usize = 256;

/// Default capacity of the per-bridge broadcast channels that fan a
/// single upstream WebSocket out to every interested SSE consumer
/// (live UI stream, `chat_persist_task`, watchdog, etc.). Raised
/// from 4096 → 16384 in Phase 1.3 of the agent-stream reliability
/// plan to absorb bursty tool-heavy turns without dropping events.
/// Override at runtime with `AURA_HARNESS_BROADCAST_CAPACITY`.
pub const DEFAULT_BROADCAST_CAPACITY: usize = 16384;

/// Env var that overrides [`DEFAULT_BROADCAST_CAPACITY`]. Must parse
/// to a positive `usize`; any other value (missing, blank, 0, or
/// non-numeric) falls back to the default.
pub const BROADCAST_CAPACITY_ENV: &str = "AURA_HARNESS_BROADCAST_CAPACITY";

/// Reads `AURA_HARNESS_BROADCAST_CAPACITY` from the environment with
/// the same fallbacks `spawn_ws_bridge` uses. Re-exported via
/// [`crate::ws_bridge_config`] so aura-os-server's `/api/admin/health`
/// snapshot reports the exact value the harness bridge will sum onto
/// its broadcast channels.
pub fn read_broadcast_capacity_from_env() -> usize {
    std::env::var(BROADCAST_CAPACITY_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_BROADCAST_CAPACITY)
}

pub(crate) fn spawn_ws_bridge<S>(
    ws_stream: S,
) -> (
    broadcast::Sender<OutboundMessage>,
    broadcast::Sender<serde_json::Value>,
    mpsc::Sender<InboundMessage>,
)
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Send
        + 'static,
    <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    let cap = read_broadcast_capacity_from_env();
    let (outbound_tx, _) = broadcast::channel::<OutboundMessage>(cap);
    let (raw_tx, _) = broadcast::channel::<serde_json::Value>(cap);
    let (inbound_tx, inbound_rx) = mpsc::channel::<InboundMessage>(WS_COMMAND_BUFFER);

    let (ws_sink, ws_stream_read) = ws_stream.split();
    spawn_bridge_reader(ws_stream_read, outbound_tx.clone(), raw_tx.clone());
    spawn_bridge_writer(ws_sink, inbound_rx);

    (outbound_tx, raw_tx, inbound_tx)
}

fn spawn_bridge_reader<R>(
    mut ws_stream_read: R,
    reader_tx: broadcast::Sender<OutboundMessage>,
    reader_raw_tx: broadcast::Sender<serde_json::Value>,
) where
    R: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + Unpin
        + Send
        + 'static,
{
    tokio::spawn(async move {
        while let Some(msg_result) = ws_stream_read.next().await {
            if handle_ws_message(msg_result, &reader_tx, &reader_raw_tx) {
                break;
            }
        }
    });
}

fn handle_ws_message(
    msg_result: Result<WsMessage, tokio_tungstenite::tungstenite::Error>,
    reader_tx: &broadcast::Sender<OutboundMessage>,
    reader_raw_tx: &broadcast::Sender<serde_json::Value>,
) -> bool {
    match msg_result {
        Ok(WsMessage::Text(text)) => {
            debug!(
                direction = "received",
                payload_len = text.len(),
                payload = %debug_payload(&text),
                "WS frame received"
            );
            forward_ws_text(&text, reader_tx, reader_raw_tx);
            false
        }
        Ok(WsMessage::Close(_)) => {
            stability_metrics::inc_ws_closed();
            let _ = reader_tx.send(bridge_error(
                "harness_ws_closed",
                "harness websocket closed",
                true,
            ));
            true
        }
        Err(e) => {
            debug!(error = %e, "WebSocket read error");
            stability_metrics::inc_ws_read_error();
            let _ = reader_tx.send(bridge_error(
                "harness_ws_read_error",
                format!("harness websocket read error: {e}"),
                true,
            ));
            true
        }
        _ => false,
    }
}

fn forward_ws_text(
    text: &str,
    reader_tx: &broadcast::Sender<OutboundMessage>,
    reader_raw_tx: &broadcast::Sender<serde_json::Value>,
) {
    match serde_json::from_str::<OutboundMessage>(text) {
        Ok(event) => {
            debug!("Parsed harness event");
            let _ = reader_tx.send(event);
        }
        Err(err) => forward_untyped_ws_text(text, err, reader_tx, reader_raw_tx),
    }
}

fn forward_untyped_ws_text(
    text: &str,
    err: serde_json::Error,
    reader_tx: &broadcast::Sender<OutboundMessage>,
    reader_raw_tx: &broadcast::Sender<serde_json::Value>,
) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
        warn!(
            direction = "received",
            payload_len = text.len(),
            payload = %debug_payload(text),
            error = %err,
            "Forwarding untyped harness event"
        );
        stability_metrics::inc_protocol_mismatch();
        let _ = reader_raw_tx.send(value);
        let _ = reader_tx.send(bridge_error(
            "harness_protocol_mismatch",
            format!("harness websocket emitted an unsupported event shape: {err}"),
            true,
        ));
    } else {
        warn!(
            direction = "received",
            payload_len = text.len(),
            payload = %debug_payload(text),
            "Non-JSON harness message, dropping"
        );
        stability_metrics::inc_protocol_mismatch();
        let _ = reader_tx.send(bridge_error(
            "harness_protocol_mismatch",
            "harness websocket emitted a non-JSON message",
            true,
        ));
    }
}

fn spawn_bridge_writer<W>(mut ws_sink: W, mut inbound_rx: mpsc::Receiver<InboundMessage>)
where
    W: SinkExt<WsMessage> + Unpin + Send + 'static,
    <W as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    tokio::spawn(async move {
        while let Some(cmd) = inbound_rx.recv().await {
            if send_ws_command(&mut ws_sink, cmd).await {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });
}

async fn send_ws_command<W>(ws_sink: &mut W, cmd: InboundMessage) -> bool
where
    W: SinkExt<WsMessage> + Unpin,
    <W as futures_util::Sink<WsMessage>>::Error: std::fmt::Display,
{
    match serde_json::to_string(&cmd) {
        Ok(json) => {
            debug!(
                direction = "sent",
                payload_len = json.len(),
                payload = %debug_payload(&json),
                "WS frame sending"
            );
            ws_sink.send(WsMessage::Text(json.into())).await.is_err()
        }
        Err(e) => {
            warn!("Failed to serialize harness command: {e}");
            false
        }
    }
}

fn bridge_error(code: &str, message: impl Into<String>, recoverable: bool) -> OutboundMessage {
    OutboundMessage::Error(ErrorMsg {
        code: code.to_string(),
        message: message.into(),
        recoverable,
    })
}

fn debug_payload(text: &str) -> String {
    let mut preview = String::new();
    for ch in text.chars() {
        if preview.len() + ch.len_utf8() > WS_DEBUG_PAYLOAD_LIMIT {
            break;
        }
        preview.push(ch);
    }

    if preview.len() < text.len() {
        preview.push_str("...");
    }

    preview
}

// Reconnect follow-up: spawn_ws_bridge currently receives an already-upgraded
// WebSocket stream and has no request/session-resume context. Callers can now
// distinguish bounded-channel backpressure and reader close/error events; a
// true reconnect loop should be added at the session-open layer once protocol
// resume semantics are available.
//
// Phase 2 of the chat reliability plan deliberately handles WS death via
// initial-connect retry (see `LocalHarness::open_session` and
// `SwarmHarness::open_session_socket`) plus client-side auto-retry of the
// last user message on `streamDropped`, since true mid-turn resume blocks
// on `session_resume` semantics in aura-node that are not yet on the wire.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_payload_truncates_large_frames() {
        let input = "x".repeat(WS_DEBUG_PAYLOAD_LIMIT + 100);
        let payload = debug_payload(&input);

        assert_eq!(payload.len(), WS_DEBUG_PAYLOAD_LIMIT + 3);
        assert!(payload.ends_with("..."));
    }

    #[test]
    fn debug_payload_preserves_short_frames() {
        assert_eq!(debug_payload("{\"type\":\"ping\"}"), "{\"type\":\"ping\"}");
    }

    #[test]
    fn untyped_json_emits_visible_protocol_error() {
        let (typed_tx, mut typed_rx) = broadcast::channel(8);
        let (raw_tx, mut raw_rx) = broadcast::channel(8);

        forward_ws_text("{\"type\":\"unknown_event\"}", &typed_tx, &raw_tx);

        let typed = typed_rx.try_recv().expect("typed protocol error");
        assert!(matches!(
            typed,
            OutboundMessage::Error(ErrorMsg { ref code, .. }) if code == "harness_protocol_mismatch"
        ));
        let raw = raw_rx.try_recv().expect("raw diagnostic event");
        assert_eq!(raw["type"], "unknown_event");
    }

    #[test]
    fn non_json_message_emits_visible_protocol_error() {
        let (typed_tx, mut typed_rx) = broadcast::channel(8);
        let (raw_tx, mut raw_rx) = broadcast::channel(8);

        forward_ws_text("not json", &typed_tx, &raw_tx);

        let typed = typed_rx.try_recv().expect("typed protocol error");
        assert!(matches!(
            typed,
            OutboundMessage::Error(ErrorMsg { ref code, .. }) if code == "harness_protocol_mismatch"
        ));
        assert!(raw_rx.try_recv().is_err());
    }
}
