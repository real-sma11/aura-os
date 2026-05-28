use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc};

use aura_protocol::{
    AgentCapabilities, AgentIdentity, AgentPermissionsWire, AgentPersona, AgentToolPermissionsWire,
    ChatProjectInfoWire, ConversationMessage, InboundMessage, InstalledIntegration,
    IntentClassifierSpec, ModelSelection, OutboundMessage, ProjectContext, RuntimeRequest,
    RuntimeRequestType, SessionModelOverrides, WorkspaceLocation,
};

use crate::error::HarnessError;

#[derive(Default)]
pub struct SessionConfig {
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
    pub max_turns: Option<u32>,
    pub workspace: Option<String>,
    pub agent_id: Option<String>,
    /// Template agent id for harness skill / permissions / billing lookup
    /// when the partitioned `agent_id` is in use. See
    /// [`aura_protocol::AgentIdentity::template_id`].
    pub template_agent_id: Option<String>,
    /// Originating end-user id for harness-side tool defaults.
    pub user_id: Option<String>,
    /// Human-readable display name for the remote agent.
    /// When omitted the swarm harness falls back to `agent_id`.
    pub agent_name: Option<String>,
    pub token: Option<String>,
    pub conversation_messages: Option<Vec<ConversationMessage>>,
    pub project_id: Option<String>,
    /// Absolute path to the project directory on the local filesystem.
    pub project_path: Option<String>,
    /// Domain tools to register with the harness for this session.
    pub installed_tools: Option<Vec<aura_protocol::InstalledTool>>,
    /// Enabled integrations to authorize for this runtime session.
    pub installed_integrations: Option<Vec<InstalledIntegration>>,
    /// Storage session UUID for X-Aura-Session-Id billing header.
    pub aura_session_id: Option<String>,
    /// Org UUID for X-Aura-Org-Id billing header.
    pub aura_org_id: Option<String>,
    /// Optional per-session model overrides applied on top of the
    /// harness env-default router config.
    pub provider_overrides: Option<SessionModelOverrides>,
    /// Capability + scope bundle the harness must enforce for this
    /// session.
    pub agent_permissions: AgentPermissionsWire,
    /// Optional per-turn intent classifier. CEO-style agents populate
    /// this so the harness narrows the visible tool set each turn.
    pub intent_classifier: Option<IntentClassifierSpec>,
    /// Optional per-agent tool permission override stamped onto this
    /// session.
    pub tool_permissions: Option<AgentToolPermissionsWire>,
    /// Chat-WS migration: typed agent persona (name / role /
    /// personality). Forwarded onto
    /// [`aura_protocol::AgentIdentity::persona`] so the harness's
    /// `SystemPromptBuilder` renders the `<agent_identity>` section.
    pub agent_identity: Option<AgentPersona>,
    /// Chat-WS migration: operator-curated skills list.
    pub agent_skills: Vec<String>,
    /// Chat-WS migration: operator-authored system prompt.
    pub agent_system_prompt: Option<String>,
    /// Chat-WS migration: typed project descriptor. Forwarded onto
    /// [`aura_protocol::ProjectContext::project_info`].
    pub project_info: Option<ChatProjectInfoWire>,
}

pub struct HarnessSession {
    pub session_id: String,
    pub events_tx: broadcast::Sender<OutboundMessage>,
    /// Raw JSON events that did not match the typed `OutboundMessage`
    /// enum. This lets domain-level events from the harness pass
    /// through even when the protocol crate has not been updated with
    /// those variants.
    pub raw_events_tx: broadcast::Sender<serde_json::Value>,
    pub commands_tx: HarnessCommandSender,
}

pub type HarnessCommandSender = mpsc::Sender<InboundMessage>;

#[async_trait]
pub trait HarnessLink: Send + Sync {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession>;
    async fn close_session(&self, session_id: &str) -> anyhow::Result<()>;
}

/// Canonical [`RuntimeRequest`] construction from a [`SessionConfig`].
///
/// Both [`crate::LocalHarness::open_session`] and
/// [`crate::SwarmHarness::open_session`] funnel through this helper so
/// a new wire-level field only has to be wired in one place.
///
/// Renamed from `build_session_init` in Phase A of the cross-repo
/// gateway refactor: the harness no longer accepts a `SessionInit`
/// first-frame, so chat sessions submit a [`RuntimeRequest`] over
/// HTTP and the WS attaches to the returned `run_id`.
#[must_use]
pub fn build_runtime_request(cfg: &SessionConfig) -> RuntimeRequest {
    RuntimeRequest {
        r#type: RuntimeRequestType::Chat {
            conversation_messages: cfg.conversation_messages.clone().unwrap_or_default(),
        },
        agent_identity: AgentIdentity {
            template_id: cfg.template_agent_id.clone(),
            partition_id: cfg.agent_id.clone(),
            persona: cfg.agent_identity.clone(),
            skills: cfg.agent_skills.clone(),
            system_prompt: cfg.agent_system_prompt.clone(),
        },
        model: ModelSelection {
            id: cfg.model.clone(),
            max_tokens: cfg.max_tokens,
            max_turns: cfg.max_turns,
            temperature: None,
            provider_overrides: cfg.provider_overrides.clone(),
        },
        workspace: WorkspaceLocation {
            workspace: cfg.workspace.clone(),
            project_path: cfg.project_path.clone(),
            git_repo_url: None,
            git_branch: None,
        },
        project: cfg.project_id.as_ref().map(|pid| ProjectContext {
            project_id: pid.clone(),
            project_info: cfg.project_info.clone(),
            aura_org_id: cfg.aura_org_id.clone(),
            aura_session_id: cfg.aura_session_id.clone(),
            // Billing aggregates per *agent*, not per partition. When
            // the caller supplies `template_agent_id`, `agent_id` is
            // the `{template}::{instance}` partition string used
            // solely for the harness turn-lock; the billing header
            // must stay on the stable template id.
            aura_agent_id: cfg
                .template_agent_id
                .clone()
                .or_else(|| cfg.agent_id.clone()),
        }),
        agent_permissions: cfg.agent_permissions.clone(),
        tool_permissions: cfg.tool_permissions.clone(),
        agent_capabilities: AgentCapabilities {
            installed_tools: cfg.installed_tools.clone().unwrap_or_default(),
            installed_integrations: cfg.installed_integrations.clone().unwrap_or_default(),
            intent_classifier: cfg.intent_classifier.clone(),
        },
        auth_jwt: cfg.token.clone(),
        user_id: cfg.user_id.clone().unwrap_or_default(),
    }
}

/// Tier 2 fail-fast: harness-side preflight that mirrors the
/// minimum required identity contract enforced by the server's
/// `handlers::agents::session_identity::validate_session_identity`.
///
/// Renamed from `validate_session_init_identity` in Phase A.
pub fn validate_runtime_request_identity(cfg: &SessionConfig) -> Result<(), HarnessError> {
    if is_blank(cfg.aura_org_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "aura_org_id",
            context: "runtime_request",
        });
    }
    if is_blank(cfg.aura_session_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "aura_session_id",
            context: "runtime_request",
        });
    }
    if is_blank(cfg.template_agent_id.as_deref()) && is_blank(cfg.agent_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "agent_id",
            context: "runtime_request",
        });
    }
    // Token is optional for public-guest sessions (aura_org_id ==
    // "public"). The harness provider skips the Authorization header
    // when token is None, and the router assigns user_id
    // "public-guest". All other sessions must carry a token.
    let is_public = cfg
        .aura_org_id
        .as_deref()
        .map(|v| v == "public")
        .unwrap_or(false);
    if !is_public && is_blank(cfg.token.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "auth_token",
            context: "runtime_request",
        });
    }
    Ok(())
}

fn is_blank(value: Option<&str>) -> bool {
    value.map(|v| v.trim().is_empty()).unwrap_or(true)
}

/// Projection of [`SessionConfig`] used by
/// [`crate::SwarmHarness::open_session`]'s HTTP bootstrap
/// (`POST /v1/agents/:id/sessions`).
#[must_use]
pub fn build_remote_handshake(cfg: &SessionConfig) -> serde_json::Value {
    serde_json::json!({
        "config": {
            "system_prompt": cfg.system_prompt,
            "model": cfg.model,
            "max_tokens": cfg.max_tokens,
            "max_turns": cfg.max_turns,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_cfg() -> SessionConfig {
        SessionConfig {
            aura_org_id: Some("org-1".into()),
            aura_session_id: Some("session-1".into()),
            template_agent_id: Some("template-1".into()),
            agent_id: Some("template-1::instance-1".into()),
            token: Some("jwt".into()),
            ..Default::default()
        }
    }

    #[test]
    fn validate_accepts_fully_populated_config() {
        assert!(validate_runtime_request_identity(&full_cfg()).is_ok());
    }

    #[test]
    fn validate_rejects_missing_org_id() {
        let mut cfg = full_cfg();
        cfg.aura_org_id = None;
        let err = validate_runtime_request_identity(&cfg).unwrap_err();
        assert!(matches!(
            err,
            HarnessError::SessionIdentityMissing {
                field: "aura_org_id",
                ..
            }
        ));
    }

    #[test]
    fn validate_rejects_blank_session_id() {
        let mut cfg = full_cfg();
        cfg.aura_session_id = Some("   ".into());
        let err = validate_runtime_request_identity(&cfg).unwrap_err();
        assert!(matches!(
            err,
            HarnessError::SessionIdentityMissing {
                field: "aura_session_id",
                ..
            }
        ));
    }

    #[test]
    fn validate_accepts_agent_id_when_template_missing() {
        let mut cfg = full_cfg();
        cfg.template_agent_id = None;
        assert!(validate_runtime_request_identity(&cfg).is_ok());
    }

    #[test]
    fn validate_rejects_missing_both_agent_identities() {
        let mut cfg = full_cfg();
        cfg.template_agent_id = None;
        cfg.agent_id = None;
        let err = validate_runtime_request_identity(&cfg).unwrap_err();
        assert!(matches!(
            err,
            HarnessError::SessionIdentityMissing {
                field: "agent_id",
                ..
            }
        ));
    }

    #[test]
    fn validate_rejects_missing_auth_token() {
        let mut cfg = full_cfg();
        cfg.token = None;
        let err = validate_runtime_request_identity(&cfg).unwrap_err();
        assert!(matches!(
            err,
            HarnessError::SessionIdentityMissing {
                field: "auth_token",
                ..
            }
        ));
    }

    #[test]
    fn validate_does_not_require_user_id() {
        let mut cfg = full_cfg();
        cfg.user_id = None;
        assert!(validate_runtime_request_identity(&cfg).is_ok());
    }
}
