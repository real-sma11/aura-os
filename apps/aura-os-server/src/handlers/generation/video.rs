use axum::extract::State;
use axum::Json;
use tracing::info;

use crate::error::ApiResult;
use crate::handlers::billing;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::harness_stream::{open_generation_stream, resolve_generation_identity};
use super::sse::SseResponse;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerateVideoRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub aspect_ratio: Option<String>,
    pub duration_seconds: Option<u8>,
    pub resolution: Option<String>,
    pub generate_audio: Option<bool>,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    pub name: Option<String>,
}

pub(crate) async fn generate_video_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    Json(body): Json<GenerateVideoRequest>,
) -> ApiResult<SseResponse> {
    billing::require_credits(&state, &jwt).await?;
    info!(model = ?body.model, "Video generation stream requested");

    let identity =
        resolve_generation_identity(&state, &auth_session, &jwt, body.project_id.as_deref())
            .await?;

    open_generation_stream(
        state,
        jwt,
        aura_protocol::GenerationRequest {
            mode: "video".to_string(),
            prompt: Some(body.prompt),
            model: body.model,
            size: None,
            image_url: None,
            images: None,
            project_id: body.project_id,
            parent_id: None,
            is_iteration: None,
            aspect_ratio: body.aspect_ratio,
            duration_seconds: body.duration_seconds,
            resolution: body.resolution,
            generate_audio: body.generate_audio,
        },
        identity,
        None,
    )
    .await
}
