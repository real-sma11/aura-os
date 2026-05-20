//! `/ws/events` forwarder. Subscribes to the app-wide
//! `event_broadcast` channel and pushes each JSON event to the
//! connected client as a text frame. All logs in this module use
//! `target: "aura::ws"` so Phase 6's diagnostic story can grep on a
//! single tracing target across publisher (`event_bus.rs`) and
//! forwarder (here).

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use tracing::{debug, info, trace, warn};

use crate::state::AppState;

pub(crate) async fn ws_events(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    info!(target: "aura::ws", "ws upgrade requested");
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: AppState) {
    debug!(target: "aura::ws", "ws subscriber connected");
    let mut rx = state.event_broadcast.subscribe();

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(value) => {
                        let json = serde_json::to_string(&value).unwrap_or_default();
                        // Phase 6 per-message trace. Trace level is off
                        // by default so this stays silent in production
                        // unless an operator explicitly turns it on with
                        // `RUST_LOG=aura::ws=trace`. Pairs with the
                        // `publishing chat event` debug in `event_bus.rs`
                        // to confirm the broadcast made it all the way
                        // out the socket.
                        trace!(
                            target: "aura::ws",
                            bytes = json.len(),
                            "forwarding ws message to client"
                        );
                        if socket.send(Message::Text(json)).await.is_err() {
                            warn!(target: "aura::ws", "ws send failed; closing connection");
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // Slow subscriber fell behind the broadcast
                        // ring buffer; `n` events were dropped on the
                        // floor for this connection. Continue the
                        // loop so the client can resume from the
                        // newest available event rather than tearing
                        // down the WS — re-subscribing would be
                        // strictly worse (it would reset back to the
                        // newest position anyway).
                        warn!(
                            target: "aura::ws",
                            skipped = n,
                            "ws subscriber lagged behind; dropped messages"
                        );
                        continue;
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
    debug!(target: "aura::ws", "ws subscriber disconnected");
}
