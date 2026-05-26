//! Auto-bind agents to a per-org "Home" project so their direct chats
//! can be persisted.
//!
//! Storage requires every chat session to live under a `project_agent`
//! row (`/api/project-agents/{id}/sessions`). A universe-scoped agent
//! template (including the CEO preset and any user-created agent
//! created via `POST /api/agents`) has no natural project home until
//! it gets explicitly assigned, which means its first chat turn would
//! fail with `chat_persist_unavailable`. This module provides the
//! shared helper that auto-creates (or reuses) a Home project in the
//! agent's org and creates the binding.
//!
//! Previously only the CEO bootstrap path did this (see
//! `handlers::agent_bootstrap::setup_ceo_agent`). This helper
//! generalizes the logic so:
//!
//! 1. `POST /api/agents` can call it after creating any new agent so
//!    chat "just works" out of the box.
//! 2. `setup_agent_chat_persistence` can call it lazily on first chat
//!    if the agent has no binding yet — this self-heals existing
//!    orphans on prod without any manual step.

use std::sync::Arc;

use tracing::{info, warn};

use aura_os_core::Agent;
use aura_os_network::NetworkClient;

use crate::handlers::projects;
use crate::state::AppState;

/// Confirm the agent template still exists upstream before we (re-)create
/// a Home binding for it. Returns `true` when the template is missing
/// (404), in which case callers MUST skip the binding step — otherwise
/// the chat-side self-heal in [`super::chat::setup::setup_agent_chat_persistence`]
/// resurrects the binding immediately after the user just removed it as
/// part of `delete_agent`'s cascade. Network/auth failures fail open
/// (return `false`) so transient blips don't block the auto-bind for
/// new agents on first chat.
async fn agent_template_is_deleted(state: &AppState, jwt: &str, agent_id: &str) -> bool {
    let Some(client) = state.network_client.as_ref() else {
        return false;
    };
    match client.get_agent(agent_id, jwt).await {
        Ok(_) => false,
        Err(aura_os_network::NetworkError::Server { status: 404, .. }) => true,
        Err(_) => false,
    }
}

/// Project name used for the auto-created Home project. A project
/// with this name is only treated as an auto-home if its description
/// also starts with [`AGENT_HOME_PROJECT_MARKER`] or the legacy
/// [`CEO_HOME_PROJECT_MARKER`], so a user-authored project literally
/// called "Home" never gets adopted.
pub(crate) const HOME_PROJECT_NAME: &str = "Home";

/// Current sentinel in the description of the auto-created Home
/// project. Applied to every newly created Home project going forward,
/// regardless of which agent triggered the creation.
pub(crate) const AGENT_HOME_PROJECT_MARKER: &str = "[aura:agent-home]";

/// Legacy sentinel kept for backward compatibility. Existing CEO-home
/// projects on prod were created with this prefix; the find step
/// matches either marker so we transparently reuse them instead of
/// creating a second Home project per org.
pub(crate) const CEO_HOME_PROJECT_MARKER: &str = "[aura:ceo-home]";

fn description_is_auto_home(description: &str) -> bool {
    description.starts_with(AGENT_HOME_PROJECT_MARKER)
        || description.starts_with(CEO_HOME_PROJECT_MARKER)
}

/// Ensure `agent` has at least one `project_agent` binding so chat can
/// be persisted. Safe to call more than once — if a binding already
/// exists the function is a cheap no-op.
///
/// Strategy:
/// 1. If any project in the agent's org already has a `project_agent`
///    row pointing at `agent.agent_id`, we're done.
/// 2. Otherwise, find an existing auto-home project in the agent's org
///    (matched by name + either home marker). This transparently reuses
///    the legacy `[aura:ceo-home]` project if one was already created.
/// 3. If none exists, create a new Home project tagged with
///    [`AGENT_HOME_PROJECT_MARKER`].
/// 4. Create a `project_agent` binding for the agent in that project.
///
/// Best-effort: every network/storage failure is logged and swallowed
/// so a transient error never blocks the calling request. Callers that
/// require the binding before proceeding (e.g. lazy repair in the chat
/// handler) should re-check for a binding after calling this helper.
pub(crate) async fn ensure_agent_home_project_and_binding(
    state: &AppState,
    jwt: &str,
    agent: &Agent,
) {
    let Some(storage) = state.storage_client.as_ref().cloned() else {
        warn!(
            agent_id = %agent.agent_id,
            "agent home: storage client not configured; skipping binding"
        );
        return;
    };
    let Some(network) = state.network_client.as_ref().cloned() else {
        warn!(
            agent_id = %agent.agent_id,
            "agent home: network client not configured; skipping binding"
        );
        return;
    };
    let agent_id_str = agent.agent_id.to_string();
    // Legacy agents created before the UI started stamping `org_id` (and any
    // future agents whose upstream record drops the field) end up with
    // `agent.org_id == None`. Without an org we can't decide which Home
    // project to bind to, so historically we returned early — which made
    // the chat hot path's lazy heal a no-op and surfaced
    // `chat_persist_unavailable` to the user. Fall back to the caller's
    // single org when there is exactly one; if the caller belongs to
    // multiple orgs we still bail (ambiguous), and the existing
    // `scripts/backfill_agent_orgs.ts` is the manual escape hatch.
    let org_id: String = match agent.org_id.as_ref().map(|o| o.to_string()) {
        Some(id) => id,
        None => match resolve_caller_single_org(&network, jwt).await {
            Some(id) => {
                info!(
                    %agent_id_str,
                    caller_org_id = %id,
                    "agent home: agent has no own org_id; falling back to caller's single org"
                );
                id
            }
            None => {
                warn!(
                    %agent_id_str,
                    "agent home: agent has no org_id and caller has zero or multiple orgs; \
                     skipping binding (run scripts/backfill_agent_orgs.ts to repair)"
                );
                return;
            }
        },
    };

    // Don't resurrect a binding for an agent template that was just
    // deleted. The chat-side self-heal calls into here every turn for
    // any agent that is missing a binding, so without this guard the
    // cascade-delete in `delete_agent` (which removes the binding right
    // before deleting the template) would race against the heal and
    // sometimes leave a Home binding pointing at a dead template.
    if agent_template_is_deleted(state, jwt, &agent_id_str).await {
        info!(
            %agent_id_str,
            "agent home: template no longer exists upstream; skipping binding"
        );
        return;
    }

    let all_projects = match projects::list_all_projects_from_network(state, jwt).await {
        Ok(p) => p,
        Err(e) => {
            warn!(
                error = ?e,
                %agent_id_str,
                "agent home: failed to list projects; skipping binding"
            );
            return;
        }
    };

    // Step 1: short-circuit if the agent already has a binding anywhere.
    for project in &all_projects {
        let pid = project.project_id.to_string();
        match storage.list_project_agents(&pid, jwt).await {
            Ok(agents) => {
                if agents
                    .iter()
                    .any(|a| a.agent_id.as_deref() == Some(&agent_id_str))
                {
                    info!(
                        %agent_id_str,
                        project_id = %pid,
                        "agent home: agent already bound to a project; nothing to do"
                    );
                    return;
                }
            }
            Err(e) => {
                warn!(
                    project_id = %pid,
                    error = %e,
                    %agent_id_str,
                    "agent home: failed to list project agents"
                );
            }
        }
    }

    // Step 2/3: find or create the Home project in the agent's org.
    let existing_home = all_projects.iter().find(|p| {
        p.org_id.to_string() == org_id
            && p.name == HOME_PROJECT_NAME
            && description_is_auto_home(&p.description)
    });
    let home_pid: String = match existing_home {
        Some(p) => {
            info!(
                project_id = %p.project_id,
                %agent_id_str,
                "agent home: reusing existing Home project"
            );
            p.project_id.to_string()
        }
        None => {
            let req = aura_os_network::CreateProjectRequest {
                name: HOME_PROJECT_NAME.to_string(),
                org_id: org_id.clone(),
                description: Some(format!(
                    "{AGENT_HOME_PROJECT_MARKER} Auto-created workspace so \
                     direct chats with universe-scoped agents have \
                     somewhere to persist. You can rename this project, \
                     but don't delete it or agent chat history will stop \
                     saving."
                )),
                folder: None,
                git_repo_url: None,
                git_branch: None,
                orbit_base_url: None,
                orbit_owner: None,
                orbit_repo: None,
            };
            match network.create_project(jwt, &req).await {
                Ok(p) => {
                    info!(
                        project_id = %p.id,
                        %org_id,
                        %agent_id_str,
                        "agent home: created Home project"
                    );
                    p.id
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        %agent_id_str,
                        "agent home: failed to create Home project; skipping binding"
                    );
                    return;
                }
            }
        }
    };

    // Step 4: create a project_agent binding for the agent in the Home
    // project. Mirrors the request shape used by the standard
    // `create_agent_instance` handler.
    let binding_req = aura_os_storage::CreateProjectAgentRequest {
        agent_id: agent_id_str.clone(),
        name: agent.name.clone(),
        // Stamp the binding with the resolved org (which equals
        // `agent.org_id` when present, or the caller's single org for
        // legacy null-org agents) so teammates and downstream queries
        // can scope by org even if the upstream template row is still
        // missing the column.
        org_id: Some(org_id.clone()),
        role: Some(agent.role.clone()),
        personality: Some(agent.personality.clone()),
        system_prompt: Some(agent.system_prompt.clone()),
        skills: Some(agent.skills.clone()),
        icon: agent.icon.clone(),
        harness: None,
        // The home-project binding is the user's primary chat target,
        // so stamp it as such even when the storage backend silently
        // drops the column on older deployments.
        instance_role: Some(
            aura_os_core::AgentInstanceRole::Chat
                .as_wire_str()
                .to_string(),
        ),
        // Mark this row as the system-managed Home-project lazy bind
        // so the projects sidebar's `isUserFacingAgentInstance` filter
        // hides it. The user never asked for it; it exists purely so
        // chat persistence has a row to attach to before they ever
        // click into the agent.
        source: Some(
            aura_os_core::AgentInstanceSource::AutoHome
                .as_wire_str()
                .to_string(),
        ),
        permissions: Some(agent.permissions.clone()),
        intent_classifier: agent.intent_classifier.clone(),
    };
    match storage
        .create_project_agent(&home_pid, jwt, &binding_req)
        .await
    {
        Ok(binding) => info!(
            %agent_id_str,
            project_id = %home_pid,
            project_agent_id = %binding.id,
            "agent home: created project-agent binding"
        ),
        Err(e) => warn!(
            error = %e,
            %agent_id_str,
            project_id = %home_pid,
            "agent home: failed to create project-agent binding"
        ),
    }
}

/// Pure decision: given a list of org ids the caller belongs to, pick
/// the unambiguous one to use for a legacy agent that has no `org_id`
/// of its own. Exactly one org → `Some(id)`. Zero or many → `None`.
///
/// Multi-org orgs are intentionally left ambiguous: we don't have a
/// way to know which of the caller's orgs the agent should belong to,
/// and silently picking "first" would silently bind a teammate's
/// agent into the wrong org. Callers are expected to repair these via
/// [`scripts/backfill_agent_orgs.ts`](../../../../../../scripts/backfill_agent_orgs.ts).
fn pick_unambiguous_caller_org(caller_org_ids: &[String]) -> Option<String> {
    match caller_org_ids {
        [single] => Some(single.clone()),
        _ => None,
    }
}

/// Network-side wrapper around [`pick_unambiguous_caller_org`]: lists
/// the caller's orgs from aura-network and applies the
/// "single org wins, multi/zero ambiguous" rule. Errors and missing
/// network clients map to `None` so the heal degrades gracefully — it
/// always was a best-effort path.
async fn resolve_caller_single_org(network: &Arc<NetworkClient>, jwt: &str) -> Option<String> {
    match network.list_orgs(jwt).await {
        Ok(orgs) => {
            let ids: Vec<String> = orgs.into_iter().map(|o| o.id).collect();
            let picked = pick_unambiguous_caller_org(&ids);
            if picked.is_none() {
                info!(
                    caller_org_count = ids.len(),
                    "agent home: caller has zero or multiple orgs; cannot disambiguate"
                );
            }
            picked
        }
        Err(e) => {
            warn!(
                error = %e,
                "agent home: failed to list caller orgs for null-org agent fallback"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_new_agent_home_marker() {
        let desc = format!("{AGENT_HOME_PROJECT_MARKER} workspace");
        assert!(description_is_auto_home(&desc));
    }

    #[test]
    fn recognizes_legacy_ceo_home_marker() {
        // Existing prod deployments have a Home project created under
        // the CEO-specific marker. The find step must keep matching it
        // so we don't create a second Home project per org after this
        // change rolls out.
        let desc = format!("{CEO_HOME_PROJECT_MARKER} CEO workspace");
        assert!(description_is_auto_home(&desc));
    }

    #[test]
    fn rejects_user_authored_description() {
        assert!(!description_is_auto_home(
            "My personal workspace for side projects"
        ));
        assert!(!description_is_auto_home(""));
    }

    #[test]
    fn marker_only_counts_as_prefix() {
        // A marker embedded mid-description shouldn't trigger adoption
        // — only descriptions we wrote ourselves (prefix position) are
        // safe to claim as auto-home.
        let embedded = format!("user prose {AGENT_HOME_PROJECT_MARKER} suffix");
        assert!(!description_is_auto_home(&embedded));
    }

    #[test]
    fn picks_single_caller_org_for_null_org_agent() {
        // The legacy null-org agents that the chat-side lazy heal
        // exists to repair (see logs of agent 6df7ef90...) all hit
        // this branch: the caller is in exactly one org so binding
        // there is unambiguous. Without this fallback the heal returns
        // early and the user sees `chat_persist_unavailable`.
        let orgs = vec!["org-only-one".to_string()];
        assert_eq!(
            pick_unambiguous_caller_org(&orgs),
            Some("org-only-one".to_string())
        );
    }

    #[test]
    fn refuses_to_pick_when_caller_has_multiple_orgs() {
        // Silently picking "first" would risk binding a teammate's
        // null-org agent into the wrong org. Bail and let the
        // backfill script repair.
        let orgs = vec!["org-a".to_string(), "org-b".to_string()];
        assert_eq!(pick_unambiguous_caller_org(&orgs), None);
    }

    #[test]
    fn refuses_to_pick_when_caller_has_no_orgs() {
        // Zero-org callers shouldn't be able to bind agents at all;
        // returning None keeps the heal a no-op for them.
        let orgs: Vec<String> = Vec::new();
        assert_eq!(pick_unambiguous_caller_org(&orgs), None);
    }
}
