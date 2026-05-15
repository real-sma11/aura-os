//! Routes for the `/api/public/*` anonymous endpoint family.
//!
//! Phase 2 wiring — the routes returned here are merged into the
//! main router as a peer of [`super::auth::auth_routes`] (i.e.
//! *outside* `protected_api_router`), so they sit in front of the
//! global `require_verified_session` middleware. Guest tokens
//! issued by `POST /api/public/setup` are validated lazily by the
//! [`crate::state::AuthGuestJwt`] extractor on each route that
//! needs them; the catch-all auth guard is intentionally skipped.

use axum::routing::post;
use axum::Router;

use crate::handlers::public;
use crate::state::AppState;

/// Build the public-endpoint router. Mounted from
/// [`super::create_router_with_interface`] next to `auth_routes()`
/// — never inside `protected_api_router` — so the global auth
/// middleware never inspects the request.
pub(super) fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/api/public/setup", post(public::public_setup))
        .route(
            "/api/public/chat/stream",
            post(public::public_chat_stream),
        )
}
