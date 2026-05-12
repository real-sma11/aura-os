use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PREFS_KEY: &str = "desktop_preferences";
const CF: &str = "settings";

#[derive(Debug, Serialize, Deserialize, Default)]
pub(crate) struct DesktopPreferences {
    pub logo_color: Option<String>,
    pub pulse_enabled: Option<bool>,
    pub pulse_mode: Option<String>,  // "fade" | "sweep"
    pub pulse_speed: Option<f32>,    // seconds, 0.5–5.0
    pub pulse_from_color: Option<String>,
    pub sweep_reversed: Option<bool>,
    pub pulse_pause: Option<f32>,
}

pub(crate) async fn get_desktop_preferences(
    State(state): State<AppState>,
) -> ApiResult<Json<DesktopPreferences>> {
    let prefs = state
        .store
        .get_cf_bytes(CF, PREFS_KEY.as_bytes())
        .map_err(|e| ApiError::internal(e.to_string()))?
        .and_then(|bytes| serde_json::from_slice::<DesktopPreferences>(&bytes).ok())
        .unwrap_or_default();
    Ok(Json(prefs))
}

pub(crate) async fn patch_desktop_preferences(
    State(state): State<AppState>,
    Json(req): Json<DesktopPreferences>,
) -> ApiResult<Json<DesktopPreferences>> {
    let bytes = serde_json::to_vec(&req).map_err(|e| ApiError::internal(e.to_string()))?;
    state
        .store
        .put_cf_bytes(CF, PREFS_KEY.as_bytes(), &bytes)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(req))
}
