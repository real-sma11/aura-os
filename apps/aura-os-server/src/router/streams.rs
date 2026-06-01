use axum::routing::{get, post};
use axum::Router;

use crate::handlers::{agents, streams};
use crate::state::AppState;

/// Resumable-stream endpoints. Mounted inside the protected API router
/// so `require_verified_session` populates the `AuthSession` extractor
/// the handlers use for ownership checks.
pub(super) fn stream_routes() -> Router<AppState> {
    Router::new()
        .route("/api/streams/active", get(streams::list_active_streams))
        // Subagent attach is registered BEFORE the `:attach_id` wildcard
        // so `/api/streams/subagents/...` is not shadowed by it.
        .route(
            "/api/streams/subagents/:child_run_id/attach",
            post(agents::attach_subagent_stream),
        )
        .route(
            "/api/streams/subagents/:child_run_id/send",
            post(agents::send_subagent_message),
        )
        .route("/api/streams/:attach_id", get(streams::attach_stream))
        .route(
            "/api/streams/:attach_id/cancel",
            post(streams::cancel_stream),
        )
}
