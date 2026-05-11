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

/// Cap an uploaded image asset (banner, background image) at 5 MiB.
/// Large enough for a hero-resolution PNG/JPEG without blowing up
/// request memory; small enough that a pathological client can't keep
/// posting unbounded payloads.
pub(crate) const IMAGE_ASSET_MAX_BYTES: usize = 5 * 1024 * 1024;

const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8, 0xFF];

const APPEARANCE_FILENAME: &str = "appearance.json";
const BANNER_PNG: &str = "banner.png";
const BANNER_JPG: &str = "banner.jpg";
const BACKGROUND_PNG: &str = "background.png";
const BACKGROUND_JPG: &str = "background.jpg";

/// One pair of `(png_name, jpg_name)` filenames the image-asset
/// handlers probe / write under in the `.aura/` directory. Lets the
/// banner and background-image flows share PUT/GET/DELETE bodies
/// without copy-pasting magic-byte handling, atomic-rename, etc.
struct ImageAssetSpec {
    label: &'static str,
    png: &'static str,
    jpg: &'static str,
}

const BANNER_ASSET: ImageAssetSpec = ImageAssetSpec {
    label: "banner",
    png: BANNER_PNG,
    jpg: BANNER_JPG,
};

const BACKGROUND_ASSET: ImageAssetSpec = ImageAssetSpec {
    label: "background image",
    png: BACKGROUND_PNG,
    jpg: BACKGROUND_JPG,
};

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

/// Identify an image upload's format by magic bytes and return the
/// canonical filename it should be written under for the given asset
/// spec. PNG and JPEG only — covers the formats every browser file
/// picker can produce out of the box.
fn detect_image_format(body: &[u8], spec: &ImageAssetSpec) -> Option<&'static str> {
    if body.len() >= PNG_MAGIC.len() && &body[..PNG_MAGIC.len()] == PNG_MAGIC {
        Some(spec.png)
    } else if body.len() >= JPEG_MAGIC.len() && &body[..JPEG_MAGIC.len()] == JPEG_MAGIC {
        Some(spec.jpg)
    } else {
        None
    }
}

/// Shared body for image-asset uploads (banner, background image).
/// Validates size + magic bytes, writes atomically via tmp+rename,
/// removes any stale other-extension file so format swaps don't
/// leave orphans. Returns the asset-specific URL keyed by the
/// `url_key` parameter so the caller's JSON shape stays predictable.
async fn put_image_asset(
    state: &AppState,
    project_id_raw: &str,
    spec: &ImageAssetSpec,
    body: &Bytes,
    url_key: &str,
    url_path: impl Fn(&ProjectId) -> String,
) -> ApiResult<Json<Value>> {
    if body.len() > IMAGE_ASSET_MAX_BYTES {
        return Err(ApiError::bad_request(format!(
            "{} payload {} bytes exceeds the {} byte limit",
            spec.label,
            body.len(),
            IMAGE_ASSET_MAX_BYTES
        )));
    }
    let filename = detect_image_format(body, spec).ok_or_else(|| {
        ApiError::bad_request(format!(
            "{} body must be a PNG or JPEG image",
            spec.label
        ))
    })?;

    let project_id = parse_project_id(project_id_raw)?;
    let dir = appearance_dir(state, &project_id);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to create appearance directory {}: {e}",
            dir.display()
        ))
    })?;

    let target = dir.join(filename);
    let tmp = dir.join(format!("{filename}.tmp"));
    tokio::fs::write(&tmp, body).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to write {} tmp file {}: {e}",
            spec.label,
            tmp.display()
        ))
    })?;
    tokio::fs::rename(&tmp, &target).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to commit {} file {}: {e}",
            spec.label,
            target.display()
        ))
    })?;

    // Best-effort: clean up the other-extension file so swapping formats
    // doesn't leave a stale file that the GET handler (which probes PNG
    // first) would keep serving.
    let other = if filename == spec.png { spec.jpg } else { spec.png };
    let _ = tokio::fs::remove_file(dir.join(other)).await;

    Ok(Json(json!({ url_key: url_path(&project_id) })))
}

/// Shared body for image-asset GETs. Probes PNG then JPEG; 404 when
/// neither exists. Frontend treats 404 as "no asset yet" rather than
/// surfacing an error.
async fn get_image_asset(
    state: &AppState,
    project_id_raw: &str,
    spec: &ImageAssetSpec,
) -> Response {
    let project_id = match parse_project_id(project_id_raw) {
        Ok(id) => id,
        Err((status, body)) => return (status, body).into_response(),
    };
    let dir = appearance_dir(state, &project_id);
    for (filename, mime) in [(spec.png, "image/png"), (spec.jpg, "image/jpeg")] {
        let path = dir.join(filename);
        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                return (
                    [
                        (header::CONTENT_TYPE, mime),
                        // Frontend cache-busts on update so a modest
                        // cache here is safe and avoids re-downloading
                        // the asset on every project navigation.
                        (header::CACHE_CONTROL, "private, max-age=300"),
                    ],
                    bytes,
                )
                    .into_response();
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                warn!(path = %path.display(), %err, "failed to read {} file", spec.label);
                return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
            }
        }
    }
    (StatusCode::NOT_FOUND, format!("{} not found", spec.label)).into_response()
}

/// Shared body for image-asset DELETEs. Removes both possible files
/// (png + jpg) so format swaps and follow-up deletes stay consistent.
/// Missing files are not an error.
async fn delete_image_asset(
    state: &AppState,
    project_id_raw: &str,
    spec: &ImageAssetSpec,
) -> ApiResult<Json<Value>> {
    let project_id = parse_project_id(project_id_raw)?;
    let dir = appearance_dir(state, &project_id);
    remove_if_present(&dir.join(spec.png)).await;
    remove_if_present(&dir.join(spec.jpg)).await;
    Ok(Json(json!({ "deleted": true })))
}

/// `PUT /api/projects/:project_id/appearance/banner` — writes the
/// uploaded image to `<workspace>/.aura/banner.{png,jpg}`.
pub(crate) async fn put_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    put_image_asset(
        &state,
        &project_id,
        &BANNER_ASSET,
        &body,
        "bannerUrl",
        |id| format!("/api/projects/{id}/appearance/banner"),
    )
    .await
}

/// `GET /api/projects/:project_id/appearance/banner` — serves the
/// stored banner.
pub(crate) async fn get_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> Response {
    get_image_asset(&state, &project_id, &BANNER_ASSET).await
}

/// `PUT /api/projects/:project_id/appearance/background-image` — writes
/// the uploaded image to `<workspace>/.aura/background.{png,jpg}`. Used
/// by the Appearance tab's `Image` background pattern.
pub(crate) async fn put_background_image(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    put_image_asset(
        &state,
        &project_id,
        &BACKGROUND_ASSET,
        &body,
        "backgroundImageUrl",
        |id| format!("/api/projects/{id}/appearance/background-image"),
    )
    .await
}

/// `GET /api/projects/:project_id/appearance/background-image` — serves
/// the stored background image.
pub(crate) async fn get_background_image(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> Response {
    get_image_asset(&state, &project_id, &BACKGROUND_ASSET).await
}

/// `DELETE /api/projects/:project_id/appearance/background-image` —
/// removes the stored background image (both PNG and JPEG variants).
pub(crate) async fn delete_background_image(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    delete_image_asset(&state, &project_id, &BACKGROUND_ASSET).await
}

/// `DELETE /api/projects/:project_id/appearance/banner` — removes
/// both possible banner files. Missing files are treated as success so
/// the endpoint is idempotent.
pub(crate) async fn delete_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    delete_image_asset(&state, &project_id, &BANNER_ASSET).await
}

async fn remove_if_present(path: &Path) {
    match tokio::fs::remove_file(path).await {
        Ok(()) | Err(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::{
        detect_image_format, BACKGROUND_ASSET, BANNER_ASSET, BANNER_JPG, BANNER_PNG, JPEG_MAGIC,
        PNG_MAGIC,
    };

    #[test]
    fn detect_image_format_recognises_png() {
        let mut body = Vec::from(PNG_MAGIC);
        body.extend_from_slice(b"trailing pixels");
        assert_eq!(detect_image_format(&body, &BANNER_ASSET), Some(BANNER_PNG));
    }

    #[test]
    fn detect_image_format_recognises_jpeg() {
        let mut body = Vec::from(JPEG_MAGIC);
        body.extend_from_slice(b"trailing pixels");
        assert_eq!(detect_image_format(&body, &BANNER_ASSET), Some(BANNER_JPG));
    }

    #[test]
    fn detect_image_format_rejects_unknown_magic() {
        assert_eq!(detect_image_format(b"GIF89a", &BANNER_ASSET), None);
        assert_eq!(detect_image_format(b"", &BANNER_ASSET), None);
        assert_eq!(detect_image_format(b"\x89", &BANNER_ASSET), None);
    }

    #[test]
    fn detect_image_format_routes_to_the_named_asset() {
        let mut body = Vec::from(PNG_MAGIC);
        body.extend_from_slice(b"pixels");
        // Same body, different spec → different target filename.
        assert_eq!(detect_image_format(&body, &BANNER_ASSET), Some(BANNER_PNG));
        assert_eq!(
            detect_image_format(&body, &BACKGROUND_ASSET),
            Some(BACKGROUND_ASSET.png),
        );
    }
}
