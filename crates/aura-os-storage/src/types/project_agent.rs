//! Project-agent (the "instance" of an Agent attached to a project) types.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProjectAgent {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub personality: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub harness: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    #[serde(default)]
    pub instance_role: Option<String>,
    /// Provenance marker for the row. The projects sidebar
    /// (`isUserFacingAgentInstance`) shows only rows where this is
    /// `None` (legacy) or `"ui"` (user clicked "+" in the UI). Other
    /// known values are `"auto_home"` (Home-project lazy bind),
    /// `"auto_project_default"` (new-project Standard-Agent attach),
    /// and `"sdk"` (SDK / benchmark / e2e fixtures). Stored as a free
    /// string so we never have to migrate storage when callers add
    /// new origin labels.
    #[serde(default)]
    pub source: Option<String>,
    /// Snapshot of the parent Agent's permissions at instance-creation
    /// time. Persisted so a cold reload doesn't silently fall back to
    /// an empty bundle when the parent Agent lookup fails.
    #[serde(default)]
    pub permissions: Option<aura_os_core::AgentPermissions>,
    /// Snapshot of the parent Agent's intent classifier.
    #[serde(default)]
    pub intent_classifier: Option<aura_protocol::IntentClassifierSpec>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectAgentRequest {
    pub agent_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_role: Option<String>,
    /// See [`StorageProjectAgent::source`]. Defaults to `"ui"` on the
    /// server when the caller omits it so the row stays visible in the
    /// projects sidebar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<aura_os_core::AgentPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<aura_protocol::IntentClassifierSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectAgentRequest {
    pub status: String,
}
