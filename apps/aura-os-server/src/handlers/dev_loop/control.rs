use axum::Json;
use tracing::{error, warn};

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_harness::AutomatonClient;

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::registry::{abort_and_remove, set_paused, status_response};
use super::streaming::emit_domain_event;
use super::types::ControlAction;

pub(super) async fn control_loop(
    state: &AppState,
    project_id: ProjectId,
    only_agent: Option<AgentInstanceId>,
    action: ControlAction,
) -> ApiResult<Json<LoopStatusResponse>> {
    let targets = {
        let reg = state.automaton_registry.lock().await;
        reg.iter()
            .filter(|((pid, _), _)| *pid == project_id)
            .filter(|((_, agent_id), _)| only_agent.map_or(true, |wanted| *agent_id == wanted))
            .map(|((_, agent_id), entry)| {
                (
                    *agent_id,
                    entry.automaton_id.clone(),
                    entry.harness_base_url.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    if targets.is_empty() && !matches!(action, ControlAction::Stop) {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }
    for (agent_id, automaton_id, base_url) in targets {
        control_target(ControlTargetInputs {
            state,
            project_id,
            agent_id,
            automaton_id,
            base_url,
            action: &action,
        })
        .await;
    }
    Ok(Json(status_response(state, project_id, only_agent).await))
}

/// Inputs for [`control_target`]. Bundled so the helper signature
/// stays inside the project's five-parameter ceiling.
struct ControlTargetInputs<'a> {
    state: &'a AppState,
    project_id: ProjectId,
    agent_id: AgentInstanceId,
    automaton_id: String,
    base_url: String,
    action: &'a ControlAction,
}

/// Apply a single control action (pause / resume / stop) against
/// one running automaton: dispatch to the harness, log any failure,
/// tear down the local registry slot accordingly, then emit the
/// matching `loop_*` domain event so subscribers observe the
/// transition.
///
/// Splits the work across three helpers so each phase stays inside
/// the per-function line budget:
///
/// * [`dispatch_control_action`] - the harness RPC + result mapping.
/// * [`tear_down_target`] - the local registry mutation that mirrors
///   the action.
/// * [`emit_control_event`] - the domain event the UI subscribes to.
async fn control_target(inputs: ControlTargetInputs<'_>) {
    let ControlTargetInputs {
        state,
        project_id,
        agent_id,
        automaton_id,
        base_url,
        action,
    } = inputs;
    let client = AutomatonClient::new(&base_url);
    let harness_error = match dispatch_control_action(&client, &automaton_id, action).await {
        Ok(()) => None,
        Err(error) => {
            let message = error.to_string();
            log_control_failure(action, &automaton_id, &base_url, &message);
            Some(message)
        }
    };
    tear_down_target(state, project_id, agent_id, action).await;
    emit_control_event(state, project_id, agent_id, action, harness_error);
}

/// Dispatch the action against the harness automaton. Returns the
/// raw `anyhow::Result` so [`control_target`] can capture the error
/// string (used both for the structured log row and the
/// `loop_*` event `harness_error` field).
async fn dispatch_control_action(
    client: &AutomatonClient,
    automaton_id: &str,
    action: &ControlAction,
) -> anyhow::Result<()> {
    match action {
        ControlAction::Pause => client.pause(automaton_id).await,
        ControlAction::Resume => client.resume(automaton_id).await,
        ControlAction::Stop => client.stop(automaton_id).await,
    }
}

/// Log a harness control-RPC failure. Historically this was a
/// `warn!`-only log buried in the server output, which made "UI
/// says stopped but harness is still running" effectively invisible
/// (see `loop_stop_clears_registry_even_when_harness_unreachable`
/// for why we still clear the registry regardless - that part is
/// intentional so the UI can recover when the harness is genuinely
/// dead). For `Stop` specifically, surface the failure at `error!`
/// so the streaming debug log makes the state divergence visible
/// instead of silently lying.
fn log_control_failure(
    action: &ControlAction,
    automaton_id: &str,
    base_url: &str,
    message: &str,
) {
    if matches!(action, ControlAction::Stop) {
        error!(
            %automaton_id,
            harness_base_url = %base_url,
            error = %message,
            "harness automaton stop request failed; clearing local registry but harness may still be running"
        );
    } else {
        warn!(
            %automaton_id,
            harness_base_url = %base_url,
            error = %message,
            "harness automaton control request failed"
        );
    }
}

/// Mirror the control action onto the local `automaton_registry`:
/// pause/resume flip the `paused` flag, stop aborts the forwarder
/// and removes the entry entirely. Runs regardless of whether the
/// harness RPC succeeded so the local view never diverges
/// permanently from "the user pressed stop".
async fn tear_down_target(
    state: &AppState,
    project_id: ProjectId,
    agent_id: AgentInstanceId,
    action: &ControlAction,
) {
    match action {
        ControlAction::Pause => set_paused(state, project_id, agent_id, true).await,
        ControlAction::Resume => set_paused(state, project_id, agent_id, false).await,
        ControlAction::Stop => abort_and_remove(state, project_id, agent_id).await,
    }
}

/// Emit the per-action `loop_paused` / `loop_resumed` /
/// `loop_stopped` domain event so subscribers see the transition.
/// Forwards the harness error string verbatim on the payload when
/// the RPC failed so the UI can render the state-divergence banner
/// instead of silently claiming the action succeeded.
fn emit_control_event(
    state: &AppState,
    project_id: ProjectId,
    agent_id: AgentInstanceId,
    action: &ControlAction,
    harness_error: Option<String>,
) {
    let event_payload = match harness_error {
        Some(err) => serde_json::json!({"harness_error": err}),
        None => serde_json::json!({}),
    };
    emit_domain_event(
        state,
        event_type(action),
        project_id,
        agent_id,
        event_payload,
    );
}

fn event_type(action: &ControlAction) -> &'static str {
    match action {
        ControlAction::Pause => "loop_paused",
        ControlAction::Resume => "loop_resumed",
        ControlAction::Stop => "loop_stopped",
    }
}