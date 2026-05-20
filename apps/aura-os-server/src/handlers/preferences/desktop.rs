use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const SETTING_KEY: &str = "preferences:desktop";

/// Persisted per-user desktop chrome preferences (logo color + pulse
/// animation settings). Every field is `Option<_>` so an empty payload
/// (`{}`) deserializes as "no overrides" — the frontend treats `None`
/// as "use the theme default."
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DesktopPrefs {
    #[serde(default)]
    pub logo_color: Option<String>,
    #[serde(default)]
    pub pulse_enabled: Option<bool>,
    #[serde(default)]
    pub pulse_mode: Option<String>,
    #[serde(default)]
    pub pulse_speed: Option<f32>,
    #[serde(default)]
    pub pulse_from_color: Option<String>,
    #[serde(default)]
    pub sweep_reversed: Option<bool>,
    #[serde(default)]
    pub pulse_pause: Option<f32>,
}

pub(crate) async fn get_desktop(
    AuthJwt(_): AuthJwt,
    State(state): State<AppState>,
) -> ApiResult<Json<DesktopPrefs>> {
    let prefs = state
        .store
        .get_setting(SETTING_KEY)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    Ok(Json(prefs))
}

pub(crate) async fn put_desktop(
    AuthJwt(_): AuthJwt,
    State(state): State<AppState>,
    Json(prefs): Json<DesktopPrefs>,
) -> ApiResult<Json<DesktopPrefs>> {
    let bytes = serde_json::to_vec(&prefs)
        .map_err(|e| ApiError::internal(format!("serialize desktop prefs: {e}")))?;
    state
        .store
        .put_setting(SETTING_KEY, &bytes)
        .map_err(|e| ApiError::internal(format!("persist desktop prefs: {e}")))?;
    Ok(Json(prefs))
}
