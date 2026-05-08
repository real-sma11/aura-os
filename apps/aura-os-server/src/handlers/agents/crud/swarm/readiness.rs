use std::sync::Arc;
use std::time::Duration;

use aura_os_network::{NetworkAgent, NetworkClient};
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::state::AppState;

use super::SwarmAgentReadyError;

const SWARM_AGENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const SWARM_AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(serde::Deserialize)]
struct SwarmAgentStateResponse {
    state: String,
    /// Optional diagnostic surfaced by the swarm gateway when the agent
    /// has been escalated to `error`. Carries through to the chat
    /// surface, the polling proxy, and the auto-recovery broadcasts so
    /// the user sees the actual cause (e.g. `Unschedulable`) rather
    /// than a generic "entered error state" message.
    #[serde(default)]
    error_message: Option<String>,
}

/// Owned-data context for the background readiness check spawned by
/// [`spawn_swarm_readiness_check`]. Bundling these into a struct keeps the
/// public spawn function under the 5-parameter rule.
///
/// In addition to the readiness wait inputs, this struct carries enough
/// context for the spawned task to invoke
/// [`super::recovery::recover_remote_agent_pipeline`] once if the initial
/// readiness wait fails -- so brand-new agents whose first pod gets stuck
/// don't strand the user on a manual Recover click.
pub(super) struct BackgroundReadinessTask {
    pub state: AppState,
    pub network: Arc<NetworkClient>,
    pub net_agent: NetworkAgent,
    pub jwt: String,
    pub provisioned_agent_id: String,
    pub vm_id: String,
}

/// Borrowed-data context for the broadcasting readiness wait used during the
/// recovery pipeline. Bundling these into a struct keeps the wait function
/// under the 5-parameter rule.
pub(super) struct BroadcastReadinessRequest<'a> {
    pub http: &'a reqwest::Client,
    pub swarm_base_url: &'a str,
    pub jwt: &'a str,
    pub swarm_agent_id: &'a str,
    pub aura_agent_id: &'a str,
    pub broadcast: &'a broadcast::Sender<serde_json::Value>,
}

pub(super) fn spawn_swarm_readiness_check(task: BackgroundReadinessTask) {
    tokio::spawn(async move {
        let swarm_base_url = match task.state.swarm_base_url.clone() {
            Some(url) => url,
            None => {
                warn!(
                    agent_id = %task.net_agent.id,
                    "Background readiness check started without SWARM_BASE_URL; aborting"
                );
                return;
            }
        };

        let result = wait_for_swarm_agent_ready(
            task.network.http_client(),
            &swarm_base_url,
            &task.jwt,
            &task.provisioned_agent_id,
        )
        .await;

        match result {
            Ok(()) => {
                info!(
                    agent_id = %task.net_agent.id,
                    vm_id = %task.vm_id,
                    "Remote agent reached ready state in background"
                );
            }
            Err(SwarmAgentReadyError::Timeout) => {
                warn!(
                    agent_id = %task.net_agent.id,
                    vm_id = %task.vm_id,
                    "Remote agent still provisioning after background readiness timeout; \
                     attempting one auto-recovery cycle"
                );
                auto_recover_after_initial_failure(
                    &task,
                    Some(format!(
                        "initial readiness wait timed out after {}s",
                        SWARM_AGENT_READY_TIMEOUT.as_secs()
                    )),
                )
                .await;
            }
            Err(SwarmAgentReadyError::ErrorState(reason)) => {
                warn!(
                    agent_id = %task.net_agent.id,
                    vm_id = %task.vm_id,
                    reason = ?reason,
                    "Remote agent entered error state during background readiness check; \
                     attempting one auto-recovery cycle"
                );
                auto_recover_after_initial_failure(&task, reason).await;
            }
            Err(SwarmAgentReadyError::Transport(msg)) => {
                warn!(
                    agent_id = %task.net_agent.id,
                    vm_id = %task.vm_id,
                    error = %msg,
                    "Background readiness check transport error; not attempting auto-recovery"
                );
            }
            Err(SwarmAgentReadyError::Parse(msg)) => {
                warn!(
                    agent_id = %task.net_agent.id,
                    vm_id = %task.vm_id,
                    error = %msg,
                    "Background readiness check parse error; not attempting auto-recovery"
                );
            }
        }
    });
}

/// Run a single auto-recovery cycle for a freshly-created remote agent whose
/// initial readiness wait failed. Broadcasts a starting event, runs the
/// existing `recover_remote_agent_pipeline` once, and -- if that also fails
/// -- broadcasts a terminal `state: "error"` event so the desktop UI exits
/// the indeterminate "Starting up..." state and shows the manual Recovery
/// action with the real underlying cause attached.
async fn auto_recover_after_initial_failure(
    task: &BackgroundReadinessTask,
    swarm_reason: Option<String>,
) {
    broadcast_auto_recover(
        &task.state,
        &task.net_agent.id,
        "starting",
        "provisioning",
        swarm_reason.as_deref(),
    );

    let result = super::recovery::recover_remote_agent_pipeline(
        &task.state,
        &task.network,
        &task.jwt,
        &task.net_agent,
    )
    .await;

    match result {
        Ok(reprovisioned) => {
            info!(
                agent_id = %task.net_agent.id,
                new_vm_id = ?reprovisioned.agent.vm_id,
                "Auto-recovery succeeded after initial readiness failure"
            );
        }
        Err((_, err_json)) => {
            let recovery_message = err_json.0.error.clone();
            let final_message = match swarm_reason.as_deref() {
                Some(initial) => format!(
                    "{initial}; auto-recovery also failed: {recovery_message}"
                ),
                None => format!("auto-recovery failed: {recovery_message}"),
            };
            warn!(
                agent_id = %task.net_agent.id,
                error = %final_message,
                "Auto-recovery failed; broadcasting startup_failed"
            );
            broadcast_auto_recover(
                &task.state,
                &task.net_agent.id,
                "startup_failed",
                "error",
                Some(&final_message),
            );
        }
    }
}

fn broadcast_auto_recover(
    state: &AppState,
    agent_id: &str,
    phase: &str,
    vm_state: &str,
    error_message: Option<&str>,
) {
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "remote_agent_state_changed",
        "agent_id": agent_id,
        "state": vm_state,
        "action": "auto_recover",
        "phase": phase,
        "error_message": error_message,
        "uptime_seconds": 0,
        "active_sessions": 0,
    }));
}

pub(super) async fn wait_for_swarm_agent_ready(
    http: &reqwest::Client,
    swarm_base_url: &str,
    jwt: &str,
    agent_id: &str,
) -> Result<(), SwarmAgentReadyError> {
    let url = format!("{}/v1/agents/{agent_id}/state", swarm_base_url);
    let deadline = tokio::time::Instant::now() + SWARM_AGENT_READY_TIMEOUT;

    loop {
        tokio::time::sleep(SWARM_AGENT_READY_POLL_INTERVAL).await;

        if tokio::time::Instant::now() >= deadline {
            return Err(SwarmAgentReadyError::Timeout);
        }

        match poll_swarm_agent_state(http, &url, jwt).await? {
            PollOutcome::Ready => return Ok(()),
            PollOutcome::Errored(reason) => return Err(SwarmAgentReadyError::ErrorState(reason)),
            PollOutcome::Pending(state) => {
                info!(agent_id = %agent_id, state = %state, "Waiting for remote agent provisioning");
            }
            PollOutcome::Retry => continue,
        }
    }
}

/// Same as [`wait_for_swarm_agent_ready`] but broadcasts progress events so
/// the frontend can show real-time recovery status over WebSocket.
pub(super) async fn wait_for_swarm_agent_ready_with_broadcast(
    request: BroadcastReadinessRequest<'_>,
) -> Result<(), SwarmAgentReadyError> {
    let url = format!(
        "{}/v1/agents/{}/state",
        request.swarm_base_url, request.swarm_agent_id
    );
    let deadline = tokio::time::Instant::now() + SWARM_AGENT_READY_TIMEOUT;

    loop {
        tokio::time::sleep(SWARM_AGENT_READY_POLL_INTERVAL).await;

        if tokio::time::Instant::now() >= deadline {
            return Err(SwarmAgentReadyError::Timeout);
        }

        match poll_swarm_agent_state(request.http, &url, request.jwt).await? {
            PollOutcome::Ready => return Ok(()),
            PollOutcome::Errored(reason) => return Err(SwarmAgentReadyError::ErrorState(reason)),
            PollOutcome::Pending(state) => {
                info!(swarm_agent_id = %request.swarm_agent_id, state = %state, "Waiting for recovered agent readiness");
                let _ = request.broadcast.send(serde_json::json!({
                    "type": "remote_agent_state_changed",
                    "agent_id": request.aura_agent_id,
                    "state": "provisioning",
                    "action": "recover",
                    "phase": "waiting_for_ready",
                    "uptime_seconds": 0,
                    "active_sessions": 0,
                }));
            }
            PollOutcome::Retry => continue,
        }
    }
}

enum PollOutcome {
    Ready,
    Errored(Option<String>),
    Pending(String),
    Retry,
}

async fn poll_swarm_agent_state(
    http: &reqwest::Client,
    url: &str,
    jwt: &str,
) -> Result<PollOutcome, SwarmAgentReadyError> {
    let resp = http
        .get(url)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| SwarmAgentReadyError::Transport(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        warn!(
            url,
            status, body, "Swarm agent state check returned non-success"
        );
        return Ok(PollOutcome::Retry);
    }

    let state = resp
        .json::<SwarmAgentStateResponse>()
        .await
        .map_err(|e| SwarmAgentReadyError::Parse(e.to_string()))?;

    Ok(match state.state.as_str() {
        "running" | "idle" => PollOutcome::Ready,
        "error" => PollOutcome::Errored(state.error_message),
        other => PollOutcome::Pending(other.to_string()),
    })
}
