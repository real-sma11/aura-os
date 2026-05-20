use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId};

#[derive(Debug)]
pub struct CreateSessionParams {
    pub agent_instance_id: AgentInstanceId,
    pub project_id: ProjectId,
    pub active_task_id: Option<TaskId>,
    pub summary: String,
    pub user_id: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct UpdateContextUsageParams {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub session_id: SessionId,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Tokens that were written into the upstream provider's prompt
    /// cache during this turn (Anthropic `cache_creation_input_tokens`).
    /// Counted toward context-window utilization because the model still
    /// processes them on the way into the cache.
    pub cache_creation_input_tokens: u64,
    /// Tokens served from the upstream provider's prompt cache during
    /// this turn (Anthropic `cache_read_input_tokens` / OpenAI
    /// `cached_tokens`). Counted toward context-window utilization
    /// because the model still sees them as part of the prompt.
    pub cache_read_input_tokens: u64,
    pub total_input_tokens: Option<u64>,
    pub total_output_tokens: Option<u64>,
    pub context_usage_estimate: Option<f64>,
}

#[derive(Debug)]
pub struct RolloverSessionParams {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub session_id: SessionId,
    pub summary: String,
    pub next_task_id: Option<TaskId>,
}
