//! Chat-WS migration helpers — assemble the typed identity / project
//! info wire fields the harness's `SystemPromptBuilder` consumes,
//! replacing the legacy server-side prompt baking that lived in
//! `identity_preamble.rs` and `instance_route/project_prompt.rs`.
//!
//! aura-os no longer concatenates the chat system prompt itself: each
//! chat call site loads the same operator-authored fields from its
//! `agent_instance` / `agent` row and the matching project record, and
//! forwards them on the wire as
//! [`SessionConfig::agent_identity`] / [`SessionConfig::agent_skills`] /
//! [`SessionConfig::agent_system_prompt`] / [`SessionConfig::project_info`].
//! The harness then renders the canonical
//! `<chat_capabilities>` + `<agent_identity>` + `<agent_skills>` +
//! `<agent_system_prompt>` + `<project_context>` + `<agents_md>`
//! envelope via `SystemPromptBuilder`.
//!
//! [`SessionConfig::agent_identity`]: aura_os_harness::SessionConfig::agent_identity
//! [`SessionConfig::agent_skills`]: aura_os_harness::SessionConfig::agent_skills
//! [`SessionConfig::agent_system_prompt`]: aura_os_harness::SessionConfig::agent_system_prompt
//! [`SessionConfig::project_info`]: aura_os_harness::SessionConfig::project_info

use aura_os_core::ProjectId;
use aura_protocol::{AgentIdentityWire, ChatProjectInfoWire};

use crate::handlers::plan_mode::PLAN_MODE_SYSTEM_PROMPT_SUFFIX;
use crate::state::AppState;

use super::compaction::append_project_state_to_system_prompt;

/// Bundle of typed wire fields produced by [`build_typed_session_fields`].
///
/// All four are surfaced on
/// [`aura_os_harness::SessionConfig`] as `agent_identity`,
/// `agent_skills`, `agent_system_prompt`, and `project_info`. The
/// caller leaves the legacy `system_prompt: Option<String>` empty so
/// the harness's chat path takes the typed-fields branch.
pub struct TypedSessionFields {
    pub agent_identity: Option<AgentIdentityWire>,
    pub agent_skills: Vec<String>,
    pub agent_system_prompt: Option<String>,
    pub project_info: Option<ChatProjectInfoWire>,
}

/// Inputs for [`build_typed_session_fields`]. Borrowed shape mirrors
/// the per-call-site state already loaded by the chat handlers — the
/// helper does not re-fetch the agent/instance row, project record,
/// or project-state snapshot from storage.
pub struct TypedSessionInputs<'a> {
    /// Operator-authored agent identity.
    pub name: &'a str,
    pub role: &'a str,
    pub personality: &'a str,
    /// Operator-curated skills list (instance / agent template
    /// `skills` column).
    pub skills: &'a [String],
    /// The "system prompt" textarea on the agent template
    /// (`instance.system_prompt` / `agent.system_prompt`).
    pub agent_template_prompt: &'a str,
    /// Persisted specs+tasks continuity snapshot (chat handlers load
    /// this on cold start). When non-empty the helper folds it into
    /// `agent_system_prompt` with the same "Use the following
    /// persisted project state ..." preamble the legacy concatenation
    /// path produced.
    pub project_state_snapshot: Option<&'a str>,
    /// `true` ⇒ the helper appends [`PLAN_MODE_SYSTEM_PROMPT_SUFFIX`]
    /// to `agent_system_prompt`, mirroring the legacy
    /// `append_plan_mode_suffix` call site.
    pub plan_mode: bool,
    /// Project descriptor + workspace path for the chat path's
    /// `<project_context>` block. `None` ⇒ bare-agent (non-project)
    /// chat — the harness skips the section entirely.
    pub project: Option<TypedProjectInputs<'a>>,
}

/// Project descriptor inputs for [`build_typed_session_fields`]. The
/// caller already has the project record (or has resolved it from the
/// AppState) and the workspace path for tool execution; this helper
/// forwards both onto the wire as a single typed struct.
pub struct TypedProjectInputs<'a> {
    pub project_id: &'a ProjectId,
    pub workspace_path: Option<&'a str>,
}

/// Assemble the typed wire-field bundle for one chat session.
///
/// Field semantics:
///
/// * `agent_identity`: `None` when every identity sub-field is blank
///   (preserves the legacy `build_identity_preamble` "no identity ⇒
///   empty preamble" contract).
/// * `agent_skills`: cloned verbatim — empty list ⇒ harness drops the
///   `<agent_skills>` section.
/// * `agent_system_prompt`: the template prompt with the
///   project-state continuity snapshot and plan-mode suffix
///   concatenated on. Empty / blank result ⇒ `None` so the harness
///   skips the section.
/// * `project_info`: built from the project record (when one is
///   provided) so the harness can render `<project_context>` from
///   structured fields.
pub fn build_typed_session_fields(
    state: &AppState,
    inputs: TypedSessionInputs<'_>,
) -> TypedSessionFields {
    let agent_identity = build_agent_identity(inputs.name, inputs.role, inputs.personality);
    let agent_skills = inputs.skills.to_vec();
    let agent_system_prompt = build_agent_system_prompt(
        inputs.agent_template_prompt,
        inputs.project_state_snapshot,
        inputs.plan_mode,
    );
    let project_info = inputs
        .project
        .and_then(|p| build_project_info(state, p.project_id, p.workspace_path));

    TypedSessionFields {
        agent_identity,
        agent_skills,
        agent_system_prompt,
        project_info,
    }
}

/// Project the operator identity prose onto [`AgentIdentityWire`].
/// Returns `None` (the harness then drops the section) when every
/// field is blank, matching the legacy `build_identity_preamble`
/// "all-empty ⇒ zero-byte preamble" semantics.
fn build_agent_identity(name: &str, role: &str, personality: &str) -> Option<AgentIdentityWire> {
    let wire = AgentIdentityWire {
        name: name.to_string(),
        role: role.to_string(),
        personality: personality.to_string(),
    };
    (!wire.is_empty()).then_some(wire)
}

/// Concatenate the agent-template prompt with the project-state
/// continuity snapshot (when present) and the plan-mode suffix
/// (when applicable).
///
/// The state-snapshot prefix string is intentionally identical to the
/// legacy `append_project_state_to_system_prompt` output so the
/// resulting `<agent_system_prompt>` body reads the same as the
/// pre-migration server-baked tail.
fn build_agent_system_prompt(
    agent_template_prompt: &str,
    project_state_snapshot: Option<&str>,
    plan_mode: bool,
) -> Option<String> {
    let mut out = append_project_state_to_system_prompt(agent_template_prompt, project_state_snapshot);
    if plan_mode {
        out.push_str(PLAN_MODE_SYSTEM_PROMPT_SUFFIX);
    }
    if out.trim().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Build the typed project descriptor from the project record (when
/// resolvable) plus the caller-supplied workspace path. Returns
/// `None` when the project lookup fails — the harness then skips
/// `<project_context>` rather than emitting an empty envelope.
fn build_project_info(
    state: &AppState,
    project_id: &ProjectId,
    workspace_path: Option<&str>,
) -> Option<ChatProjectInfoWire> {
    let project = state.project_service.get_project(project_id).ok()?;
    Some(ChatProjectInfoWire {
        id: project_id.to_string(),
        name: project.name,
        description: project.description,
        workspace_root: workspace_path.unwrap_or("").to_string(),
        build_command: project.build_command.unwrap_or_default(),
        test_command: project.test_command.unwrap_or_default(),
    })
}
