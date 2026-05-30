use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::warn;
use uuid::Uuid;

use crate::bug_report_store::{BugReport, BugReportStore};
use crate::error::{ApiError, ApiResult};
use crate::handlers::permissions::require_sys_admin;
use crate::state::{AppState, AuthJwt, AuthSession};

const BUG_REPORT_MODEL: &str = "aura-claude-opus-4-8";
const BUG_REPORT_MAX_TOKENS: u32 = 2048;
const BUG_REPORT_SYSTEM_PROMPT: &str = "You are an expert software engineer triaging a private bug report for the AURA dev team. \
You are given a free-text description of an issue plus a JSON bundle of diagnostics (prompt/conversation context, model, agent/session identity, error details, and machine/environment info). \
Respond in GitHub-flavoured markdown with exactly three sections: \
(1) `## Summary` — a concise, plain-language summary of the issue; \
(2) `## Likely root cause` — your best assessment of what is going wrong and why, grounded in the diagnostics; \
(3) `## Possible fixes` — a ranked, numbered list of concrete fixes from most to least likely to resolve the issue. \
Be specific and technical. Do not invent details that are not supported by the report.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateBugReportRequest {
    pub description: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub diagnostics: serde_json::Value,
    #[serde(default)]
    pub consent: bool,
    #[serde(default)]
    pub consent_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateBugReportResponse {
    pub id: Uuid,
}

/// Generate the Opus 4.8 triage summary by calling aura-router's
/// Anthropic-style `/v1/messages` endpoint, mirroring the round-trip
/// shape used by `generate_session_summary`.
async fn generate_bug_report_summary(
    state: &AppState,
    jwt: &str,
    description: &str,
    diagnostics: &serde_json::Value,
) -> Result<String, String> {
    let diagnostics_text = serde_json::to_string_pretty(diagnostics)
        .unwrap_or_else(|_| diagnostics.to_string());
    let user_content =
        format!("Issue description:\n{description}\n\nDiagnostics bundle (JSON):\n{diagnostics_text}");

    let req_body = json!({
        "model": BUG_REPORT_MODEL,
        "max_tokens": BUG_REPORT_MAX_TOKENS,
        "system": [
            {
                "type": "text",
                "text": BUG_REPORT_SYSTEM_PROMPT,
                "cache_control": { "type": "ephemeral" }
            }
        ],
        "messages": [{ "role": "user", "content": user_content }],
    });

    let resp = state
        .http_client
        .post(format!("{}/v1/messages", state.router_url))
        .bearer_auth(jwt)
        .header("anthropic-beta", "prompt-caching-2024-07-31")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("LLM returned {status}: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parsing LLM response: {e}"))?;

    let text = body
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|block| block.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("LLM returned empty content".to_string());
    }
    Ok(text)
}

pub(crate) async fn create_bug_report(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateBugReportRequest>,
) -> ApiResult<(StatusCode, Json<CreateBugReportResponse>)> {
    if !req.consent {
        return Err(ApiError::bad_request(
            "consent is required to submit a bug report",
        ));
    }
    if req.description.trim().is_empty() {
        return Err(ApiError::bad_request("description is required"));
    }

    let llm_summary =
        match generate_bug_report_summary(&state, &jwt, &req.description, &req.diagnostics).await {
            Ok(summary) => Some(summary),
            Err(error) => {
                warn!(%error, "bug report LLM summary failed; persisting report without summary");
                None
            }
        };

    let now = Utc::now();
    let report = BugReport {
        id: Uuid::new_v4(),
        created_at: now,
        user_id: session.user_id.clone(),
        network_user_id: session.network_user_id.map(|id| id.to_string()),
        display_name: session.display_name.clone(),
        description: req.description,
        category: req.category,
        severity: req.severity,
        diagnostics: req.diagnostics,
        llm_summary,
        status: "new".to_string(),
        consent: req.consent,
        consent_version: req.consent_version,
        consented_at: Some(now),
    };

    let store = BugReportStore::new(state.store.clone());
    store.put(&report).map_err(ApiError::internal)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateBugReportResponse { id: report.id }),
    ))
}

pub(crate) async fn list_bug_reports(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
) -> ApiResult<Json<Vec<BugReport>>> {
    require_sys_admin(&session)?;
    let store = BugReportStore::new(state.store.clone());
    let reports = store.list().map_err(ApiError::internal)?;
    Ok(Json(reports))
}

pub(crate) async fn get_bug_report(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<BugReport>> {
    require_sys_admin(&session)?;
    let uuid = Uuid::parse_str(&id).map_err(|_| ApiError::bad_request("invalid bug report id"))?;
    let store = BugReportStore::new(state.store.clone());
    let report = store
        .get(&uuid)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("bug report not found"))?;
    Ok(Json(report))
}

pub(crate) async fn list_my_bug_reports(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
) -> ApiResult<Json<Vec<BugReport>>> {
    let store = BugReportStore::new(state.store.clone());
    let network_user_id = session.network_user_id.map(|id| id.to_string());
    let reports = store
        .list()
        .map_err(ApiError::internal)?
        .into_iter()
        .filter(|r| {
            r.user_id == session.user_id
                || (network_user_id.is_some() && r.network_user_id == network_user_id)
        })
        .collect();
    Ok(Json(reports))
}
