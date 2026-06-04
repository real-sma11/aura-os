use axum::routing::{get, post, put};
use axum::Router;

use crate::handlers::notes;
use crate::state::AppState;

/// Authed (`AuthJwt`) notes routes. Blog writes (under the reserved
/// `AURA_BLOG_PROJECT_ID`) are additionally gated on sys-admin inside the
/// handlers; the anonymous published-blog reads live in `router/public.rs`.
pub(super) fn notes_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/notes/projects/:project_id/tree",
            get(notes::list_tree),
        )
        .route(
            "/api/notes/projects/:project_id/notes",
            post(notes::create_note),
        )
        .route(
            "/api/notes/projects/:project_id/notes/:note_id",
            get(notes::get_note)
                .put(notes::update_note)
                .delete(notes::delete_note),
        )
        .route(
            "/api/notes/projects/:project_id/notes/:note_id/transition",
            post(notes::transition_note),
        )
        .route(
            "/api/notes/projects/:project_id/folders",
            post(notes::create_folder),
        )
        .route(
            "/api/notes/projects/:project_id/folders/:folder_id",
            put(notes::update_folder).delete(notes::delete_folder),
        )
        .route(
            "/api/notes/projects/:project_id/notes/:note_id/comments",
            get(notes::list_comments).post(notes::create_comment),
        )
        .route(
            "/api/notes/projects/:project_id/notes/:note_id/comments/:comment_id",
            axum::routing::delete(notes::delete_comment),
        )
}
