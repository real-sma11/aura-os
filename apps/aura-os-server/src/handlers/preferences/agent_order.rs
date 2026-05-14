use std::collections::HashMap;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const SETTING_KEY: &str = "preferences:agent_order";

/// Persisted agent display order for each surface.
///
/// `agents_app` is the canonical order set by dragging in the Agents app.
/// `projects_app` maps project_id → ordered agent_id list and is shared by
/// both the Projects and Tasks surfaces. `None` means "inherit from agents_app".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentOrderPrefs {
    #[serde(default)]
    pub agents_app: Vec<String>,
    #[serde(default)]
    pub projects_app: Option<HashMap<String, Vec<String>>>,
}

pub(crate) async fn get_agent_order(
    AuthJwt(_): AuthJwt,
    State(state): State<AppState>,
) -> ApiResult<Json<AgentOrderPrefs>> {
    let prefs = state
        .store
        .get_setting(SETTING_KEY)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    Ok(Json(prefs))
}

pub(crate) async fn put_agent_order(
    AuthJwt(_): AuthJwt,
    State(state): State<AppState>,
    Json(prefs): Json<AgentOrderPrefs>,
) -> ApiResult<Json<AgentOrderPrefs>> {
    let bytes = serde_json::to_vec(&prefs)
        .map_err(|e| ApiError::internal(format!("serialize agent order: {e}")))?;
    state
        .store
        .put_setting(SETTING_KEY, &bytes)
        .map_err(|e| ApiError::internal(format!("persist agent order: {e}")))?;
    Ok(Json(prefs))
}
