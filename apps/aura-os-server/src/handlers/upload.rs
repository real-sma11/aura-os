//! Upload proxy handler — proxies presign requests to aura-router.

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

#[derive(Debug, Deserialize)]
pub(crate) struct PresignRequest {
    pub content_type: String,
    pub filename: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct PresignResponse {
    pub upload_url: String,
    pub file_url: String,
    pub key: String,
    pub expires_in: u64,
}

/// POST /api/upload/presign
///
/// Proxies to aura-router's `/v1/upload/presign` with the user's JWT
/// forwarded for auth. Returns a presigned S3 PUT URL for direct
/// client-side upload.
pub(crate) async fn presign_upload(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Json(body): Json<PresignRequest>,
) -> ApiResult<Json<PresignResponse>> {
    let url = format!("{}/v1/upload/presign", state.router_url);

    let resp = state
        .http_client
        .post(&url)
        .bearer_auth(&jwt)
        .json(&serde_json::json!({
            "content_type": body.content_type,
            "filename": body.filename,
        }))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Upload presign: router request failed");
            ApiError::bad_gateway(format!("upstream request failed: {e}"))
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!(%status, body = %text, "Upload presign: router returned error");
        return Err(ApiError::bad_gateway(format!(
            "upstream returned {status}: {text}"
        )));
    }

    let result: PresignResponse = resp.json().await.map_err(|e| {
        tracing::error!(error = %e, "Upload presign: failed to parse router response");
        ApiError::internal(format!("invalid upstream response: {e}"))
    })?;

    Ok(Json(result))
}
