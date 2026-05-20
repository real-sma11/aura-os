use std::collections::HashMap;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const SETTING_KEY: &str = "preferences:theme_overrides";

/// Persisted app-wide theme token overrides (the writable side of
/// `Settings → Appearance → Custom colors` + `Icon select accent`).
///
/// Three independent slices:
/// - `dark` / `light` — per-resolved-theme working set, keyed by CSS
///   custom-property name (e.g. `--color-border`).
/// - `global` — tokens whose value is the same in both resolved
///   themes (e.g. `--color-icon-selected`), kept outside the per-mode
///   maps so switching dark ↔ light doesn't drop them.
///
/// Stored opaquely as `HashMap<String, String>` on the wire so the
/// Rust side never has to mirror the `EditableToken` enum from the
/// frontend — sanitization happens client-side on load.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ThemeOverridesPrefs {
    #[serde(default)]
    pub dark: HashMap<String, String>,
    #[serde(default)]
    pub light: HashMap<String, String>,
    #[serde(default)]
    pub global: HashMap<String, String>,
}

pub(crate) async fn get_theme_overrides(
    AuthJwt(_): AuthJwt,
    State(state): State<AppState>,
) -> ApiResult<Json<ThemeOverridesPrefs>> {
    let prefs = state
        .store
        .get_setting(SETTING_KEY)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    Ok(Json(prefs))
}

pub(crate) async fn put_theme_overrides(
    AuthJwt(_): AuthJwt,
    State(state): State<AppState>,
    Json(prefs): Json<ThemeOverridesPrefs>,
) -> ApiResult<Json<ThemeOverridesPrefs>> {
    let bytes = serde_json::to_vec(&prefs)
        .map_err(|e| ApiError::internal(format!("serialize theme overrides: {e}")))?;
    state
        .store
        .put_setting(SETTING_KEY, &bytes)
        .map_err(|e| ApiError::internal(format!("persist theme overrides: {e}")))?;
    Ok(Json(prefs))
}
