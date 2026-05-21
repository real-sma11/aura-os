use std::sync::atomic::Ordering;

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_events::LoopKind;

use crate::dto::{ActiveLoopTask, LoopStatusResponse};
use crate::state::AppState;

pub(super) async fn set_paused(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    paused: bool,
) {
    if let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .get_mut(&(project_id, agent_instance_id))
    {
        entry.paused = paused;
    }
}

pub(super) async fn can_reuse_forwarder(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) -> bool {
    state
        .automaton_registry
        .lock()
        .await
        .get(&(project_id, agent_instance_id))
        .is_some_and(|entry| {
            entry.automaton_id == automaton_id && entry.alive.load(Ordering::SeqCst)
        })
}

pub(super) async fn replace_registry_entry(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
) {
    abort_and_remove(state, project_id, agent_instance_id).await;
}

pub(super) async fn abort_and_remove(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
) {
    if let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .remove(&(project_id, agent_instance_id))
    {
        if let Some(handle) = entry.forwarder {
            handle.abort();
        }
    }
}

pub(super) async fn status_response(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
) -> LoopStatusResponse {
    let reg = state.automaton_registry.lock().await;
    let active: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|((pid, _), _)| *pid == project_id)
        .map(|((_, agent_id), _)| *agent_id)
        .collect();
    let paused = reg
        .iter()
        .any(|((pid, _), entry)| *pid == project_id && entry.paused);
    drop(reg);
    // `current_task_id` lives on `LoopActivity` (Phase 5: LoopHandle is
    // the single authoritative source). Walk the loop registry for
    // every Automation / TaskRun loop bound to this project and pull
    // the typed `TaskId` straight off the activity payload.
    let active_tasks = state
        .loop_registry
        .snapshot_where(|loop_id| {
            loop_id.project_id == Some(project_id)
                && matches!(loop_id.kind, LoopKind::Automation | LoopKind::TaskRun)
        })
        .into_iter()
        .filter_map(|snapshot| {
            let agent_id = snapshot.loop_id.agent_instance_id?;
            let task_id = snapshot.activity.current_task_id?;
            Some(ActiveLoopTask {
                task_id: task_id.to_string(),
                agent_instance_id: agent_id,
            })
        })
        .collect::<Vec<_>>();
    let running = !active.is_empty();
    LoopStatusResponse {
        running,
        paused,
        loop_state: Some(
            if paused {
                "paused"
            } else if running {
                "running"
            } else {
                "finished"
            }
            .to_string(),
        ),
        project_id: Some(project_id),
        agent_instance_id,
        active_agent_instances: Some(active),
        cooldown_remaining_ms: None,
        cooldown_reason: None,
        cooldown_kind: None,
        active_tasks: Some(active_tasks),
    }
}
