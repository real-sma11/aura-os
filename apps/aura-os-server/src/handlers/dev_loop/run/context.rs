//! Step 2 of the run pipeline: resolve the
//! [`super::super::types::StartContext`] (workspace, agent template,
//! model, permissions) and clone the JWT for forwarder use.
//!
//! For [`super::request::RunMode::SingleTask`], a
//! `resolve_start_context` failure triggers a best-effort delete of
//! the ephemeral executor row the adapter just minted - preserving
//! the behaviour of the original `run_single_task` guard at
//! `adapter/run_single.rs:60-67`.

use crate::error::ApiResult;

use super::super::start::resolve_start_context;
use super::super::types::StartContext;
use super::request::{RunMode, RunRequest};

/// Per-run context bundle. Carries the resolved
/// [`StartContext`] plus run-derived bookkeeping the downstream
/// pipeline steps need.
pub(super) struct RunContext {
    pub(super) start: StartContext,
    /// JWT clone earmarked for the forwarder. Cloned BEFORE
    /// `build_start_params` consumes the request JWT so the
    /// forwarder retains a usable token for background storage
    /// writes (`tasks.execution_notes`, etc.).
    pub(super) forwarder_jwt: String,
    /// Stringified task id, populated only for
    /// [`RunMode::SingleTask`]. Used downstream by
    /// `build_start_params`, `seed_task_output`, and the
    /// `task_started` event payload.
    pub(super) task_id_str: Option<String>,
}

pub(super) async fn prepare_run_context(req: &RunRequest) -> ApiResult<RunContext> {
    let start = match resolve_start_context(
        &req.state,
        req.project_id,
        req.template_agent_instance_id,
        &req.jwt,
        req.model.clone(),
    )
    .await
    {
        Ok(ctx) => ctx,
        Err(err) => {
            // Best-effort: don't leak the ephemeral row the adapter
            // just created if context resolution fails before we
            // even reach the harness. No-op for Automation runs
            // where the registry-keyed instance is the long-lived
            // bound Loop instance, not an ephemeral.
            spawn_ephemeral_cleanup_if_single(req);
            return Err(err);
        }
    };

    let task_id_str = match req.mode {
        RunMode::SingleTask { task_id } => Some(task_id.to_string()),
        RunMode::Automation => None,
    };

    Ok(RunContext {
        start,
        forwarder_jwt: req.jwt.clone(),
        task_id_str,
    })
}

/// Spawn a best-effort delete of the ephemeral `project_agents` row
/// the adapter minted for [`RunMode::SingleTask`]. No-op for
/// [`RunMode::Automation`].
///
/// Called from [`prepare_run_context`] and
/// [`super::automaton::start_automaton`] on the failure points the
/// pre-refactor `run_single_task` handler covered (resolve context,
/// validate identity, `client.start`). Storage failures are
/// swallowed - if the delete fails the next janitor pass cleans up.
pub(super) fn spawn_ephemeral_cleanup_if_single(req: &RunRequest) {
    if !matches!(req.mode, RunMode::SingleTask { .. }) {
        return;
    }
    let svc = req.state.agent_instance_service.clone();
    let id = req.agent_instance_id;
    tokio::spawn(async move {
        let _ = svc.delete_instance(&id).await;
    });
}
