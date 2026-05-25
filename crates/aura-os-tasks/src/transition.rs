//! Bridge-aware task state transitions against `aura-storage`.
//!
//! Source of truth for the legal (current, target) edges is
//! `aura-storage/crates/domain/tasks/src/repo.rs::validate_transition`:
//!
//! ```text
//!   pending     -> ready
//!   ready       -> in_progress
//!   in_progress -> done | failed | blocked
//!   failed      -> ready
//!   blocked     -> ready
//!   done        -> ready                (user-initiated re-do)
//! ```
//!
//! Everything else is a 400 at the HTTP boundary. Any code that needs a
//! non-adjacent hop (for example `ready -> failed` when a run aborts
//! before starting, or `in_progress -> ready` when the retry ladder
//! resets a stuck run) must bridge through intermediate states.
//!
//! The `done -> ready` edge is specifically for the user-initiated
//! "Re-do" action exposed by `POST /api/projects/:id/tasks/:id/redo`
//! — see `docs/migrations/2026-05-25-task-redo-transition.md` for the
//! corresponding aura-network rollout.
//!
//! Use [`safe_transition`] for every transition from aura-os-server:
//! it reads the current status, short-circuits on idempotent no-ops, and
//! walks the minimum hop sequence for the target state. Call sites that
//! hand-rolled a conditional `ready -> in_progress` bridge (the three
//! flavours we had in `dev_loop.rs`) should migrate to this helper so a
//! fourth flavour doesn't silently regress.

use aura_os_core::{Task, TaskStatus};
use aura_os_storage::{StorageClient, TransitionTaskRequest};

use crate::error::TaskError;
use crate::storage_task_to_task;

/// Serialised form of a `TaskStatus` expected by aura-storage's
/// `POST /api/tasks/:id/transition` body (`{"status": "<snake_case>"}`).
fn status_str(s: TaskStatus) -> &'static str {
    match s {
        TaskStatus::Backlog => "backlog",
        TaskStatus::ToDo => "to_do",
        TaskStatus::Pending => "pending",
        TaskStatus::Ready => "ready",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Blocked => "blocked",
        TaskStatus::Done => "done",
        TaskStatus::Failed => "failed",
    }
}

/// Computes the sequence of hops needed to reach `target` from `current`
/// under aura-storage's transition rules.
///
/// * `Some(vec![])`     -> already at `target`; no HTTP call needed.
/// * `Some(vec![...])`  -> perform each hop in order (last entry == `target`).
/// * `None`             -> impossible (e.g. leaving `Done`, or targeting
///   a status storage's state machine doesn't accept as a target).
///
/// `Backlog` / `ToDo` are aura-os concepts that aura-storage's schema
/// does not persist (`migrations/0003_create_tasks.sql` restricts
/// status to the six canonical values). We treat any edge that would
/// touch them as "go through storage direct" isn't safe, so we reject
/// the bridge and let the caller fall back to `IllegalTransition`.
pub fn compute_bridge(current: TaskStatus, target: TaskStatus) -> Option<Vec<TaskStatus>> {
    use TaskStatus::*;

    if current == target {
        return Some(vec![]);
    }
    // `Done` is otherwise terminal; the only legal way out is the
    // user-initiated re-do edge `done -> ready`. Every other target
    // (including indirect bridges via `Ready`) stays impossible so the
    // automation loop's auto-retry ladder cannot resurrect a completed
    // task on its own.
    if current == Done {
        return if target == Ready {
            Some(vec![Ready])
        } else {
            None
        };
    }
    if matches!(current, Backlog | ToDo) || matches!(target, Backlog | ToDo | Pending) {
        return None;
    }

    let path: Vec<TaskStatus> = match (current, target) {
        // Edges that storage accepts directly.
        (Pending, Ready)
        | (Ready, InProgress)
        | (InProgress, Done)
        | (InProgress, Failed)
        | (InProgress, Blocked)
        | (Failed, Ready)
        | (Blocked, Ready) => vec![target],

        // Multi-hop bridges.
        (Pending, InProgress) => vec![Ready, InProgress],
        (Pending, Done) => vec![Ready, InProgress, Done],
        (Pending, Failed) => vec![Ready, InProgress, Failed],
        (Pending, Blocked) => vec![Ready, InProgress, Blocked],

        (Ready, Done) => vec![InProgress, Done],
        (Ready, Failed) => vec![InProgress, Failed],
        (Ready, Blocked) => vec![InProgress, Blocked],

        (InProgress, Ready) => vec![Failed, Ready],

        (Failed, InProgress) => vec![Ready, InProgress],
        (Failed, Done) => vec![Ready, InProgress, Done],
        (Failed, Blocked) => vec![Ready, InProgress, Blocked],

        (Blocked, InProgress) => vec![Ready, InProgress],
        (Blocked, Done) => vec![Ready, InProgress, Done],
        (Blocked, Failed) => vec![Ready, InProgress, Failed],

        _ => return None,
    };

    Some(path)
}

/// Transitions `task_id` to `target`, bridging through intermediate
/// states as needed. Idempotent when already at `target`.
///
/// Returns the fully-refreshed `Task` after the final hop (or the
/// current task when no hops were needed). Errors propagate from the
/// first failing hop; any earlier hops remain applied (storage does
/// not expose a transaction around multi-step transitions).
pub async fn safe_transition(
    storage: &StorageClient,
    jwt: &str,
    task_id: &str,
    target: TaskStatus,
) -> Result<Task, TaskError> {
    let current_storage = storage.get_task(task_id, jwt).await?;
    let current_task = storage_task_to_task(current_storage).map_err(TaskError::ParseError)?;
    let current = current_task.status;

    let hops =
        compute_bridge(current, target).ok_or(TaskError::IllegalTransition { current, target })?;

    if hops.is_empty() {
        return Ok(current_task);
    }

    for hop in &hops {
        tracing::debug!(
            task_id = %task_id,
            from = ?current,
            to = ?target,
            hop = ?hop,
            "safe_transition hop",
        );
        let req = TransitionTaskRequest {
            status: status_str(*hop).to_string(),
        };
        storage.transition_task(task_id, jwt, &req).await?;
    }

    let updated = storage.get_task(task_id, jwt).await?;
    storage_task_to_task(updated).map_err(TaskError::ParseError)
}

#[cfg(test)]
mod tests {
    use super::*;
    use TaskStatus::*;

    // Storage's authoritative edge list. Kept as a const so a storage
    // change that adds/removes an edge fails this module's tests loudly.
    const STORAGE_ALLOWED_EDGES: &[(TaskStatus, TaskStatus)] = &[
        (Pending, Ready),
        (Ready, InProgress),
        (InProgress, Done),
        (InProgress, Failed),
        (InProgress, Blocked),
        (Failed, Ready),
        (Blocked, Ready),
        // User-initiated re-do of a completed task. See
        // `docs/migrations/2026-05-25-task-redo-transition.md`.
        (Done, Ready),
    ];

    const CANONICAL_STATES: &[TaskStatus] = &[Pending, Ready, InProgress, Done, Failed, Blocked];

    #[test]
    fn idempotent_on_same_state() {
        for s in CANONICAL_STATES {
            assert_eq!(
                compute_bridge(*s, *s),
                Some(vec![]),
                "{s:?} -> {s:?} should be a no-op",
            );
        }
    }

    #[test]
    fn direct_storage_edges_are_single_hop() {
        for (from, to) in STORAGE_ALLOWED_EDGES {
            assert_eq!(
                compute_bridge(*from, *to),
                Some(vec![*to]),
                "{from:?} -> {to:?} should be one hop (storage accepts directly)",
            );
        }
    }

    #[test]
    fn every_bridge_hop_is_a_legal_storage_edge() {
        for from in CANONICAL_STATES {
            for to in CANONICAL_STATES {
                let Some(hops) = compute_bridge(*from, *to) else {
                    continue;
                };
                let mut cursor = *from;
                for hop in hops {
                    assert!(
                        STORAGE_ALLOWED_EDGES.contains(&(cursor, hop)),
                        "{from:?} -> {to:?} bridge produced illegal hop {cursor:?} -> {hop:?}",
                    );
                    cursor = hop;
                }
                assert_eq!(
                    cursor, *to,
                    "{from:?} -> {to:?} bridge didn't end at target",
                );
            }
        }
    }

    #[test]
    fn done_can_only_become_ready() {
        // `Done -> Ready` is the dedicated user-initiated re-do edge.
        assert_eq!(
            compute_bridge(Done, Ready),
            Some(vec![Ready]),
            "Done -> Ready must be a single-hop user-initiated re-do",
        );
        // Every other target out of `Done` stays impossible so the
        // automation loop's auto-retry ladder can never resurrect a
        // completed task without an explicit user action.
        for to in CANONICAL_STATES {
            if matches!(*to, Done | Ready) {
                continue;
            }
            assert_eq!(
                compute_bridge(Done, *to),
                None,
                "Done -> {to:?} must be impossible (only Done -> Ready is allowed)",
            );
        }
    }

    #[test]
    fn pending_is_not_a_valid_target() {
        // Storage has no transition INTO pending; tasks are born pending.
        for from in CANONICAL_STATES {
            if *from == Pending {
                continue;
            }
            assert_eq!(
                compute_bridge(*from, Pending),
                None,
                "{from:?} -> Pending must be impossible",
            );
        }
    }

    #[test]
    fn regression_edges_that_400_today() {
        // The four edges whose 400s drove this module's creation.
        // Each must now produce a valid multi-hop bridge.
        assert_eq!(
            compute_bridge(Ready, Failed),
            Some(vec![InProgress, Failed])
        );
        assert_eq!(compute_bridge(Ready, Done), Some(vec![InProgress, Done]));
        assert_eq!(compute_bridge(InProgress, Ready), Some(vec![Failed, Ready]));
        assert_eq!(
            compute_bridge(Failed, InProgress),
            Some(vec![Ready, InProgress]),
        );
    }

    /// User-initiated re-do of a completed task. The bridge must be a
    /// single direct hop because indirect paths via `InProgress` or
    /// `Failed` would bypass the storage validator's intent (which is
    /// to require an explicit `Done -> Ready` write authorization).
    #[test]
    fn redo_edge_is_single_hop_done_to_ready() {
        assert_eq!(
            compute_bridge(Done, Ready),
            Some(vec![Ready]),
            "user-initiated re-do must be a direct hop, not bridged",
        );
    }

    #[test]
    fn backlog_and_todo_are_rejected() {
        assert_eq!(compute_bridge(Backlog, Ready), None);
        assert_eq!(compute_bridge(ToDo, Ready), None);
        assert_eq!(compute_bridge(Ready, Backlog), None);
        assert_eq!(compute_bridge(Ready, ToDo), None);
    }
}
