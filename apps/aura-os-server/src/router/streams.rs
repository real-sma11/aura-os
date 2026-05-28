use axum::routing::{get, post};
use axum::Router;

use crate::handlers::streams;
use crate::state::AppState;

/// Resumable-stream endpoints. Mounted inside the protected API router
/// so `require_verified_session` populates the `AuthSession` extractor
/// the handlers use for ownership checks.
pub(super) fn stream_routes() -> Router<AppState> {
    Router::new()
        .route("/api/streams/active", get(streams::list_active_streams))
        .route("/api/streams/:attach_id", get(streams::attach_stream))
        .route(
            "/api/streams/:attach_id/cancel",
            post(streams::cancel_stream),
        )
}
