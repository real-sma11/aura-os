use axum::routing::{delete, get, post};
use axum::Router;

use crate::handlers::channels;
use crate::state::AppState;

/// External-chat (Telegram) link management routes. Merged into the
/// authenticated group in `router/mod.rs` so `require_verified_session`
/// runs ahead of every handler.
pub(super) fn channel_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/agents/:agent_id/channels/telegram/link",
            post(channels::link_telegram),
        )
        .route("/api/agents/:agent_id/channels", get(channels::list_channels))
        .route(
            "/api/agents/:agent_id/channels/:channel_id",
            delete(channels::disconnect_channel),
        )
}
