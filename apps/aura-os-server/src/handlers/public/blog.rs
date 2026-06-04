//! Public (unauthenticated) blog reads.
//!
//! Blog posts are notes stored under the reserved
//! [`AURA_BLOG_PROJECT_ID`](crate::handlers::notes::AURA_BLOG_PROJECT_ID)
//! project. The published subset is served anonymously here: the viewer
//! has no credentials, so aura-os-server resolves the rows with its own
//! `X-Internal-Token` via `list_published_notes_internal`. Drafts never
//! reach this path — the storage internal endpoint only returns published
//! notes.

use axum::extract::{Path, State};
use axum::Json;

use aura_os_storage::StorageNote;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::notes::AURA_BLOG_PROJECT_ID;
use crate::state::AppState;

/// Sort published notes newest-first by `publishedAt`. Timestamps are
/// ISO-8601 strings so a reverse lexical sort is chronological; rows
/// missing a timestamp sort last.
fn sort_newest_first(notes: &mut [StorageNote]) {
    notes.sort_by(|a, b| b.published_at.cmp(&a.published_at));
}

/// `GET /api/public/blog`. All published blog posts, newest first.
pub(crate) async fn list_published_blog(
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<StorageNote>>> {
    let storage = state.require_storage_client()?;
    let mut notes = storage
        .list_published_notes_internal(AURA_BLOG_PROJECT_ID)
        .await
        .map_err(map_storage_error)?;
    sort_newest_first(&mut notes);
    Ok(Json(notes))
}

/// `GET /api/public/blog/:slug`. The single published post matching
/// `slug`, or 404 when none matches.
pub(crate) async fn get_published_blog_by_slug(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> ApiResult<Json<StorageNote>> {
    let storage = state.require_storage_client()?;
    let notes = storage
        .list_published_notes_internal(AURA_BLOG_PROJECT_ID)
        .await
        .map_err(map_storage_error)?;
    let note = notes
        .into_iter()
        .find(|n| n.slug.as_deref() == Some(slug.as_str()))
        .ok_or_else(|| ApiError::not_found("blog post not found"))?;
    Ok(Json(note))
}
