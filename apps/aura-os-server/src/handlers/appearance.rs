//! Project appearance handlers.
//!
//! Persists per-project visual customization (accent color, icon,
//! background style, banner image) as plain files under the project's
//! workspace folder. Two artifacts live side by side:
//!
//! - `<workspace>/.aura/appearance.json` — a small JSON blob with the
//!   non-image settings (accent, icon, background). Stored as opaque
//!   JSON so the frontend can evolve the shape without server-side
//!   churn.
//! - `<workspace>/.aura/banner.{png,jpg}` — optional banner image,
//!   magic-byte-validated on upload.
//!
//! The workspace directory resolves in this order:
//!
//! 1. The project's `local_workspace_path` if set — lets users commit
//!    `.aura/appearance.json` to their repo so customizations travel
//!    with the project.
//! 2. The canonical `<data_dir>/workspaces/<project_id>/` fallback —
//!    same path the artifact thumbnails use, so the feature still
//!    works for projects without a local checkout.
//!
//! All writes are best-effort with atomic rename semantics so a
//! half-written file can never be read by the GET handlers, and a
//! missing file is treated as "no customization" rather than an error.

use std::path::{Path, PathBuf};
use std::str::FromStr;

use axum::body::Bytes;
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use tracing::warn;

use aura_os_core::ProjectId;

use crate::error::{ApiError, ApiResult};
use crate::handlers::projects_helpers::canonical_workspace_path;
use crate::state::{AppState, AuthJwt};

/// Cap a banner upload at 5 MiB. Large enough for a hero-resolution
/// PNG/JPEG without blowing up request memory; small enough that a
/// pathological client can't keep posting unbounded payloads.
pub(crate) const BANNER_MAX_BYTES: usize = 5 * 1024 * 1024;

const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8, 0xFF];

const APPEARANCE_FILENAME: &str = "appearance.json";
const BANNER_PNG: &str = "banner.png";
const BANNER_JPG: &str = "banner.jpg";

/// Resolve the `.aura/` directory for a project. Prefers the project's
/// `local_workspace_path` when set so the file can be committed to the
/// user's repo; otherwise falls back to the canonical workspace under
/// `<data_dir>/workspaces/<project_id>/`.
fn appearance_dir(state: &AppState, project_id: &ProjectId) -> PathBuf {
    let local = state
        .project_service
        .get_project(project_id)
        .ok()
        .and_then(|p| p.local_workspace_path.clone())
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);

    let base = local.unwrap_or_else(|| canonical_workspace_path(&state.data_dir, project_id));
    base.join(".aura")
}

fn parse_project_id(raw: &str) -> ApiResult<ProjectId> {
    ProjectId::from_str(raw)
        .map_err(|e| ApiError::bad_request(format!("invalid project id '{raw}': {e}")))
}

/// `GET /api/projects/:project_id/appearance` — returns the stored
/// appearance JSON, or an empty object when no file exists yet.
pub(crate) async fn get_appearance(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_id = parse_project_id(&project_id)?;
    let path = appearance_dir(&state, &project_id).join(APPEARANCE_FILENAME);
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let value: Value = serde_json::from_slice(&bytes).map_err(|e| {
                ApiError::internal(format!(
                    "appearance file at {} is not valid JSON: {e}",
                    path.display()
                ))
            })?;
            Ok(Json(value))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Json(json!({}))),
        Err(err) => Err(ApiError::internal(format!(
            "failed to read appearance file {}: {err}",
            path.display()
        ))),
    }
}

/// `PUT /api/projects/:project_id/appearance` — writes the request
/// body to `appearance.json` atomically. Body must be a JSON object;
/// arrays and scalars are rejected so callers can't accidentally erase
/// the file shape.
pub(crate) async fn put_appearance(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    if !body.is_object() {
        return Err(ApiError::bad_request(
            "appearance payload must be a JSON object".to_string(),
        ));
    }
    let project_id = parse_project_id(&project_id)?;
    let dir = appearance_dir(&state, &project_id);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to create appearance directory {}: {e}",
            dir.display()
        ))
    })?;
    let path = dir.join(APPEARANCE_FILENAME);
    let tmp = dir.join(format!("{APPEARANCE_FILENAME}.tmp"));
    let bytes = serde_json::to_vec_pretty(&body)
        .map_err(|e| ApiError::internal(format!("failed to serialize appearance: {e}")))?;
    tokio::fs::write(&tmp, &bytes).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to write appearance tmp file {}: {e}",
            tmp.display()
        ))
    })?;
    tokio::fs::rename(&tmp, &path).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to commit appearance file {}: {e}",
            path.display()
        ))
    })?;
    Ok(Json(body))
}

/// Identify the upload's image format by magic bytes and return the
/// canonical filename to write it under. PNG and JPEG only — covers
/// the formats every browser file picker can produce out of the box.
fn detect_banner_format(body: &[u8]) -> Option<&'static str> {
    if body.len() >= PNG_MAGIC.len() && &body[..PNG_MAGIC.len()] == PNG_MAGIC {
        Some(BANNER_PNG)
    } else if body.len() >= JPEG_MAGIC.len() && &body[..JPEG_MAGIC.len()] == JPEG_MAGIC {
        Some(BANNER_JPG)
    } else {
        None
    }
}

/// `PUT /api/projects/:project_id/appearance/banner` — writes the
/// uploaded image to `<workspace>/.aura/banner.{png,jpg}`. Magic
/// bytes are validated up front so the endpoint can't be coerced into
/// dropping arbitrary blobs onto disk. Removes any stale banner with
/// the *other* extension so swapping PNG→JPEG (or vice-versa) doesn't
/// leave orphans.
pub(crate) async fn put_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    if body.len() > BANNER_MAX_BYTES {
        return Err(ApiError::bad_request(format!(
            "banner payload {} bytes exceeds the {} byte limit",
            body.len(),
            BANNER_MAX_BYTES
        )));
    }
    let filename = detect_banner_format(&body).ok_or_else(|| {
        ApiError::bad_request("banner body must be a PNG or JPEG image".to_string())
    })?;

    let project_id = parse_project_id(&project_id)?;
    let dir = appearance_dir(&state, &project_id);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to create appearance directory {}: {e}",
            dir.display()
        ))
    })?;

    let target = dir.join(filename);
    let tmp = dir.join(format!("{filename}.tmp"));
    tokio::fs::write(&tmp, &body).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to write banner tmp file {}: {e}",
            tmp.display()
        ))
    })?;
    tokio::fs::rename(&tmp, &target).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to commit banner file {}: {e}",
            target.display()
        ))
    })?;

    // Best-effort: clean up the other-extension file so swapping formats
    // doesn't leave a stale banner that would still be served by the
    // GET handler (which probes PNG first).
    let other = if filename == BANNER_PNG { BANNER_JPG } else { BANNER_PNG };
    let _ = tokio::fs::remove_file(dir.join(other)).await;

    Ok(Json(json!({
        "bannerUrl": format!("/api/projects/{project_id}/appearance/banner"),
    })))
}

/// `GET /api/projects/:project_id/appearance/banner` — serves the
/// stored banner. Probes PNG first, then JPEG. Returns 404 when
/// neither exists so the frontend can fall back to a default header.
pub(crate) async fn get_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> Response {
    let project_id = match parse_project_id(&project_id) {
        Ok(id) => id,
        Err((status, body)) => return (status, body).into_response(),
    };
    let dir = appearance_dir(&state, &project_id);
    for (filename, mime) in [(BANNER_PNG, "image/png"), (BANNER_JPG, "image/jpeg")] {
        let path = dir.join(filename);
        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                return (
                    [
                        (header::CONTENT_TYPE, mime),
                        // Frontend cache-busts on update so a modest
                        // cache here is safe and avoids re-downloading
                        // the banner on every project navigation.
                        (header::CACHE_CONTROL, "private, max-age=300"),
                    ],
                    bytes,
                )
                    .into_response();
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                warn!(path = %path.display(), %err, "failed to read banner file");
                return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
            }
        }
    }
    (StatusCode::NOT_FOUND, "banner not found").into_response()
}

/// `DELETE /api/projects/:project_id/appearance/banner` — removes
/// both possible banner files. Missing files are treated as success so
/// the endpoint is idempotent.
pub(crate) async fn delete_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_id = parse_project_id(&project_id)?;
    let dir = appearance_dir(&state, &project_id);
    remove_if_present(&dir.join(BANNER_PNG)).await;
    remove_if_present(&dir.join(BANNER_JPG)).await;
    Ok(Json(json!({ "deleted": true })))
}

async fn remove_if_present(path: &Path) {
    match tokio::fs::remove_file(path).await {
        Ok(()) | Err(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::{detect_banner_format, BANNER_JPG, BANNER_PNG, JPEG_MAGIC, PNG_MAGIC};

    #[test]
    fn detect_banner_format_recognises_png() {
        let mut body = Vec::from(PNG_MAGIC);
        body.extend_from_slice(b"trailing pixels");
        assert_eq!(detect_banner_format(&body), Some(BANNER_PNG));
    }

    #[test]
    fn detect_banner_format_recognises_jpeg() {
        let mut body = Vec::from(JPEG_MAGIC);
        body.extend_from_slice(b"trailing pixels");
        assert_eq!(detect_banner_format(&body), Some(BANNER_JPG));
    }

    #[test]
    fn detect_banner_format_rejects_unknown_magic() {
        assert_eq!(detect_banner_format(b"GIF89a"), None);
        assert_eq!(detect_banner_format(b""), None);
        assert_eq!(detect_banner_format(b"\x89"), None);
    }
}
