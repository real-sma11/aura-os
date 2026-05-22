//! Session entity (live agent run on a project) types.

use serde::{Deserialize, Serialize};

/// Wire shape for the user-scoped session list endpoint
/// (`/api/me/sessions`). Wraps `StorageSession` with the agent
/// metadata aura-os-server needs to render rows in the chat-app
/// left panel without a follow-up `listProjectBindings` fan-out
/// per agent.
///
/// Mirrors `aura_storage_sessions::models::EnrichedSession` on the
/// aura-storage side (see migration 0015). Deliberately omits an
/// `agent_name` field: there is no `name` column on
/// `project_agents` in aura-storage (see migrations 0001 + 0009),
/// so the FE resolves agent names from its existing per-agent
/// cache rather than from a column that would always be `NULL` on
/// the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEnrichedSession {
    #[serde(flatten)]
    pub session: StorageSession,
    /// `project_agents.agent_id` -- the agent identifier the FE
    /// keys avatars and stream lanes by. Distinct from
    /// `StorageSession.project_agent_id` (the per-project instance
    /// binding row id, not the agent definition).
    #[serde(default)]
    pub agent_id: Option<String>,
}

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
