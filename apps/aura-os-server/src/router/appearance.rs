use axum::extract::DefaultBodyLimit;
use axum::routing::get;
use axum::Router;

use crate::handlers::appearance::{self, BANNER_MAX_BYTES};
use crate::state::AppState;

pub(super) fn appearance_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects/:project_id/appearance",
            get(appearance::get_appearance).put(appearance::put_appearance),
        )
        // Banner upload: body limit is raised above Axum's 2 MiB default
        // so a 5 MiB PNG/JPEG can be PUT. The handler enforces the same
        // cap defensively, and we tack on a kilobyte for HTTP framing
        // overhead. The layer is harmless for GET/DELETE since they
        // carry no body.
        .route(
            "/api/projects/:project_id/appearance/banner",
            get(appearance::get_banner)
                .put(appearance::put_banner)
                .delete(appearance::delete_banner)
                .layer(DefaultBodyLimit::max(BANNER_MAX_BYTES + 1024)),
        )
}
