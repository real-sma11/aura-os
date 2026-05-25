//! Step 5 of the run pipeline: materialise (or reuse) the storage
//! `Session` row this run will be billed against.
//!
//! [`super::request::RunMode::Automation`] prefers the session
//! already stashed on the registry entry for an adopted automaton
//! (so a second cold-start on the same
//! `(project_id, agent_instance_id, automaton_id)` after a forwarder
//! crash doesn't double `total_sessions`). Cold starts and
//! [`super::request::RunMode::SingleTask`] always begin a fresh
//! session - the latter tags it with `active_task_id` so storage can
//! correlate the session with the task it was minted for.
//!
//! Returns `None` when storage isn't wired (test rigs) or the
//! `begin_session` call fails - preserving the pre-refactor
//! "session counting disabled this run" semantics rather than
//! aborting the loop start.

use aura_os_core::SessionId;

use super::super::session::{begin_session, existing_session_id};
use super::context::RunContext;
use super::request::{RunMode, RunRequest};

pub(super) async fn materialize_run_session(
    req: &RunRequest,
    prep: &RunContext,
    automaton_id: &str,
) -> Option<SessionId> {
    match req.mode {
        RunMode::Automation => {
            // Adopt-shortcut won't reach this fn (the controller
            // short-circuits before us), so the only adopt path
            // that gets here is "harness automaton was adopted but
            // its forwarder died" - reuse the registry's session
            // id rather than minting a fresh row.
            if let Some(existing) = existing_session_id(
                &req.state,
                req.project_id,
                req.agent_instance_id,
                automaton_id,
            )
            .await
            {
                return Some(existing);
            }
            begin_session(
                &req.state,
                req.project_id,
                req.agent_instance_id,
                None,
                Some(req.user_id.clone()),
                prep.start.model.clone(),
            )
            .await
        }
        RunMode::SingleTask { task_id } => {
            // Single-task runs always mint a fresh ephemeral agent
            // instance, so they always need a fresh storage session
            // - there's nothing to adopt. Tagging it with
            // `active_task_id` lets the storage backend correlate
            // the session with the task it was minted for.
            begin_session(
                &req.state,
                req.project_id,
                req.agent_instance_id,
                Some(task_id),
                Some(req.user_id.clone()),
                prep.start.model.clone(),
            )
            .await
        }
    }
}