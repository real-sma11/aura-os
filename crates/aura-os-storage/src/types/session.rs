//! Session entity (live agent run on a project) types.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSession {
    pub id: String,
    #[serde(default)]
    pub project_agent_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, alias = "contextUsage")]
    pub context_usage_estimate: Option<f64>,
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    #[serde(default, alias = "summary")]
    pub summary_of_previous_context: Option<String>,
    #[serde(default)]
    pub tasks_worked_count: Option<u32>,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    /// Number of `session_events` rows for this session. Maintained by
    /// the `session_events_after_insert` trigger in aura-storage
    /// (migration 0014). aura-os-server uses this on the list path to
    /// decide whether a row is navigable; pre-0014 deployments return
    /// `None` and we treat that as "unknown — keep the row".
    #[serde(default)]
    pub event_count: Option<u32>,
    /// Timestamp of the most recent `session_events` row for this
    /// session. Used as the primary sort key on the chat-app session
    /// list so the most recently-active sessions float to the top.
    #[serde(default)]
    pub last_event_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_usage_estimate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_of_previous_context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "contextUsage")]
    pub context_usage_estimate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "summary")]
    pub summary_of_previous_context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks_worked_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
}
