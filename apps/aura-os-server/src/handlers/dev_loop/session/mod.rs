//! Storage `Session` lifecycle for automation runs (`start_loop` /
//! `run_single_task`).
//!
//! Until this module landed, only the chat path created storage
//! `Session` rows via `SessionService` ([`crate::handlers::agents::chat`]),
//! so the Sidekick "Sessions" stat (`ProjectStats.total_sessions`) was
//! flat for any project that only ever ran automation. The dev-loop
//! adapter now calls [`begin_session`] on cold start (and reuses the
//! existing id on adopted starts), and the forwarder calls
//! [`record_task_worked`] / [`end_session`] as it observes lifecycle
//! events — bringing automation parity with chat for both
//! `total_sessions` and per-session `tasks_worked_count`.

use std::str::FromStr;

use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, SessionStatus, TaskId, TaskStatus};
use aura_os_sessions::{CreateSessionParams, SessionService};
use aura_os_storage::StorageClient;
use aura_os_tasks::storage_task_to_task;

use crate::state::AppState;

#[cfg(test)]
mod orphan_sweep_e2e_tests;

/// Create a fresh `active` storage session for an automation run.
///
/// Returns `None` when `SessionService` is not connected to storage
/// (e.g. test rigs that build the service without a storage client) or
/// the storage call fails. Callers treat `None` as "session counting
/// disabled for this run" rather than a hard error — the dev loop
/// runs to completion either way; we just don't update aura-storage
/// from the forwarder.
///
/// `active_task_id` lets `run_single_task` tag the session with the
/// task it was minted for. `start_loop` passes `None` (the loop picks
/// up tasks dynamically via `task_started` events).
/// Inputs for [`begin_session`]. Bundled to keep the helper under
/// the project's five-parameter ceiling without altering the
/// underlying [`CreateSessionParams`] wire shape.
pub(super) struct SessionInputs<'a> {
    pub(super) state: &'a AppState,
    pub(super) project_id: ProjectId,
    pub(super) agent_instance_id: AgentInstanceId,
    pub(super) active_task_id: Option<TaskId>,
    pub(super) user_id: Option<String>,
    pub(super) model: Option<String>,
}

pub(super) async fn begin_session(inputs: SessionInputs<'_>) -> Option<SessionId> {
    let SessionInputs {
        state,
        project_id,
        agent_instance_id,
        active_task_id,
        user_id,
        model,
    } = inputs;
    let params = CreateSessionParams {
        agent_instance_id,
        project_id,
        active_task_id,
        summary: String::new(),
        user_id,
        model,
    };
    match state.session_service.create_session(params).await {
        Ok(session) => Some(session.session_id),
        Err(error) => {
            warn!(
                %project_id,
                %agent_instance_id,
                %error,
                "failed to materialise storage session for automation run; \
                 total_sessions / tasks_worked_count will not include this loop"
            );
            None
        }
    }
}

/// Record per-`task_started` storage side-effects for an automation
/// run: increment `tasks_worked_count` on the session row AND stamp
/// the forwarder's `session_id` onto the storage `tasks.session_id`
/// column.
///
/// The session-row increment keeps per-session
/// `tasks_worked_count` aligned with the harness's `task_started`
/// stream so the Sessions stat reflects automation activity. The
/// task-row stamp keeps the persisted task in lockstep with the
/// in-memory `task_output_cache` stamp seeded by `seed_task_output`,
/// so the cold-read fallback inside `crate::persistence::persist_task_output`
/// (and the `fetch_task_output_from_storage` reader) finds the
/// session id even if the in-memory cache is evicted before the
/// task completes. The harness owns task transitions in production:
/// `TaskService::assign_task` (the only other writer of
/// `tasks.session_id`) is only reached from tests via
/// `claim_next_task`, so without this stamp the column would stay
/// `NULL` for every automation / `run_single_task` run.
///
/// Best-effort and idempotent: any storage failure is logged at
/// `warn` and the live run continues. Non-UUID task ids (legacy
/// synthetic `runner-N` payloads) are deliberately skipped at the
/// boundary so the typed storage column never sees an unparseable
/// id.
/// Inputs for [`record_task_worked`]. Bundled to keep the helper
/// under the project's five-parameter ceiling.
pub(super) struct RecordTaskWorkedInputs<'a> {
    pub(super) state: &'a AppState,
    pub(super) jwt: Option<&'a str>,
    pub(super) project_id: ProjectId,
    pub(super) agent_instance_id: AgentInstanceId,
    pub(super) session_id: SessionId,
    pub(super) task_id_str: &'a str,
}

pub(super) async fn record_task_worked(inputs: RecordTaskWorkedInputs<'_>) {
    let RecordTaskWorkedInputs {
        state,
        jwt,
        project_id,
        agent_instance_id,
        session_id,
        task_id_str,
    } = inputs;
    let Ok(task_id) = TaskId::from_str(task_id_str) else {
        return;
    };
    if let Err(error) = state
        .session_service
        .record_task_worked(&project_id, &agent_instance_id, &session_id, task_id)
        .await
    {
        warn!(
            %project_id,
            %agent_instance_id,
            %session_id,
            %task_id,
            %error,
            "failed to record task_worked on automation session"
        );
    }
    if let (Some(storage), Some(jwt)) = (state.storage_client.as_ref(), jwt) {
        let update = aura_os_storage::UpdateTaskRequest {
            session_id: Some(session_id.to_string()),
            ..Default::default()
        };
        if let Err(error) = storage.update_task(task_id_str, jwt, &update).await {
            warn!(
                %project_id,
                %agent_instance_id,
                %session_id,
                %task_id,
                %error,
                "failed to stamp session_id on task row at task_started; \
                 cold-read fallback may miss"
            );
        }
    }
}

/// Transition the session to its terminal status when the forwarder
/// reaches the end of its event stream. Mirrors the chat path's
/// `close_active_sessions_for_agent` for the dev loop, but writes the
/// authoritative `Completed` / `Failed` status instead of always
/// `Completed`.
pub(super) async fn end_session(
    service: &SessionService,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: SessionId,
    status: SessionStatus,
) {
    if let Err(error) = service
        .end_session(&project_id, &agent_instance_id, &session_id, status)
        .await
    {
        warn!(
            %project_id,
            %agent_instance_id,
            %session_id,
            ?status,
            %error,
            "failed to end automation session"
        );
    }
}

/// Look up the session id stashed on an adopted automaton's registry
/// entry so a second `start_loop` call on the same
/// `(project_id, agent_instance_id, automaton_id)` can reuse the live
/// session instead of creating a duplicate row.
pub(super) async fn existing_session_id(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) -> Option<SessionId> {
    state
        .automaton_registry
        .lock()
        .await
        .get(&(project_id, agent_instance_id))
        .filter(|entry| entry.automaton_id == automaton_id)
        .and_then(|entry| entry.session_id)
}

/// Single startup-time orphan sweep.
///
/// Lists the project's tasks via the storage HTTP API and issues
/// `safe_transition(InProgress -> Ready)` for every task observed in
/// `InProgress`. The criterion is "no in-memory automaton owns this
/// task right now", which is necessarily true at server startup — no
/// forwarder has come online yet — so a plain status filter
/// suffices.
///
/// The sweep covers exactly one transition:
///
/// * `InProgress -> Ready` is the mid-run orphan path. The per-task
///   retry budget lives on the persisted `tasks.attempts` column,
///   which the in-loop `task_failed` arm bumps directly — so a
///   previously-Failed task is re-readied by the live retry path,
///   not by this startup sweep.
/// * `Failed` tasks are deliberately left alone. They either need
///   manual intervention (operator clicks "Retry") or get re-readied
///   by the next `task_failed` event on the same task; either way,
///   the startup sweep does not mutate them.
///
/// Best-effort: storage / JWT failures are logged and swallowed so a
/// transient blip never blocks the loop from starting. Returns the
/// number of `InProgress` rows successfully bridged back to `Ready`.
pub(super) async fn recover_orphan_tasks(
    state: &AppState,
    project_id: ProjectId,
    jwt: &str,
) -> usize {
    let Some(storage) = state.storage_client.as_ref() else {
        return 0;
    };
    let tasks = match load_project_tasks(storage, project_id, jwt).await {
        Ok(tasks) => tasks,
        Err(error) => {
            warn!(
                %project_id,
                %error,
                "orphan recovery: failed to list tasks; skipping sweep for this loop start"
            );
            return 0;
        }
    };
    let orphans: Vec<&aura_os_core::Task> = tasks
        .iter()
        .filter(|task| task.status == TaskStatus::InProgress)
        .collect();
    if orphans.is_empty() {
        return 0;
    }
    info!(
        %project_id,
        orphan_count = orphans.len(),
        "orphan recovery: bridging InProgress tasks back to Ready"
    );
    apply_orphan_recovery(storage, jwt, &orphans).await
}

/// Load and convert the full task list for `project_id`. Conversion
/// failures on a single row are skipped with a `warn!` rather than
/// aborting the sweep — recovering the other orphans is still better
/// than leaving them all stuck.
async fn load_project_tasks(
    storage: &StorageClient,
    project_id: ProjectId,
    jwt: &str,
) -> Result<Vec<aura_os_core::Task>, aura_os_storage::StorageError> {
    let storage_tasks = storage.list_tasks(&project_id.to_string(), jwt).await?;
    let mut tasks = Vec::with_capacity(storage_tasks.len());
    for storage_task in storage_tasks {
        let task_id_for_log = storage_task.id.clone();
        match storage_task_to_task(storage_task) {
            Ok(task) => tasks.push(task),
            Err(error) => warn!(
                task_id = %task_id_for_log,
                %error,
                "orphan recovery: skipping unparseable task row",
            ),
        }
    }
    Ok(tasks)
}

/// Apply the orphan sweep: `safe_transition(InProgress -> Ready)` for
/// each task in `orphans`. Per-task failures are logged and skipped
/// so a single 4xx does not block the sweep from recovering the rest.
/// Returns the number of transitions that succeeded.
async fn apply_orphan_recovery(
    storage: &StorageClient,
    jwt: &str,
    orphans: &[&aura_os_core::Task],
) -> usize {
    let mut applied = 0;
    for task in orphans {
        let task_id_string = task.task_id.to_string();
        match aura_os_tasks::safe_transition(storage, jwt, &task_id_string, TaskStatus::Ready).await
        {
            Ok(_) => {
                applied += 1;
                info!(
                    task_id = %task.task_id,
                    from = ?task.status,
                    to = ?TaskStatus::Ready,
                    "orphan recovery: transitioned task back to Ready"
                );
            }
            Err(error) => warn!(
                task_id = %task.task_id,
                %error,
                "orphan recovery: safe_transition failed; leaving task in {:?}",
                task.status,
            ),
        }
    }
    applied
}
