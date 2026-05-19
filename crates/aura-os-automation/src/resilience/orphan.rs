//! Loop-start orphan recovery (Section E).
//!
//! When the server restarts mid-loop, a task that was previously
//! `InProgress` is left stranded — no harness is still working on
//! it, but the storage row still claims it's running, so the task
//! scheduler skips it. [`recover_orphans`] computes the set of
//! tasks that need a `safe_transition` back to `Ready` so the next
//! scheduler tick picks them up again.
//!
//! [`recover_failed`] is the sibling sweep: tasks left in
//! [`TaskStatus::Failed`] across run boundaries are re-readied on
//! loop start, gated by the same per-task retry budget the
//! in-loop `task_failed` handler already uses
//! ([`super::task_retry::TaskRetryTracker`] /
//! [`crate::budget::task_retry::TASK_LEVEL_RETRY_BUDGET`]).
//!
//! Pure functions. The App-layer caller is responsible for the
//! actual `aura_os_tasks::safe_transition` invocations.

use aura_os_core::{Task, TaskId, TaskStatus};

use super::task_retry::TaskRetryTracker;
use super::tool_retry::RetryDecision;

/// Stable static reason string the App-layer caller passes into
/// `safe_transition` (or logs alongside the transition) so the
/// resulting storage update is traceable to this recovery path.
pub const ORPHAN_RECOVERY_REASON: &str = "orphan recovery: loop killed mid-run";

/// Stable static reason string for the [`recover_failed`] sweep.
/// Distinct from [`ORPHAN_RECOVERY_REASON`] so loop logs can tell
/// the two sweeps apart and downstream telemetry can attribute the
/// `Failed -> Ready` hop to the cross-run retry path rather than
/// the mid-run orphan path.
pub const FAILED_RETRY_REASON: &str = "auto-retry: re-ready Failed task on loop start";

/// One planned `safe_transition` the App layer should apply on
/// loop start.
///
/// Fields are public-by-value so callers can pattern-match without
/// going through accessors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrphanRecoveryPlan {
    /// Task that needs recovery.
    pub task_id: TaskId,
    /// Status the task is currently stuck in. Either
    /// [`TaskStatus::InProgress`] (mid-run orphan, see
    /// [`recover_orphans`]) or [`TaskStatus::Failed`] (cross-run
    /// retry, see [`recover_failed`]). The field exists so callers
    /// can log the pre-transition state without re-querying storage.
    pub current_status: TaskStatus,
    /// Target status the caller should `safe_transition` to. Always
    /// [`TaskStatus::Ready`] today.
    pub target_status: TaskStatus,
    /// Static reason string for telemetry and logs. One of
    /// [`ORPHAN_RECOVERY_REASON`] (mid-run orphan sweep) or
    /// [`FAILED_RETRY_REASON`] (cross-run Failed sweep).
    pub reason: &'static str,
}

/// Compute the set of orphan-recovery plans for `tasks`.
///
/// Today's policy: every task observed in
/// [`TaskStatus::InProgress`] gets a plan to transition back to
/// [`TaskStatus::Ready`]. `Done`, `Failed`, `Blocked`, `Pending`,
/// `Ready`, `Backlog`, and `ToDo` are all left untouched — only
/// `InProgress` is the orphan signal (the scheduler picks `Ready`
/// tasks and pushes them into `InProgress` when it dispatches; a
/// stuck `Failed` task is handled by the task-level retry tracker,
/// not by orphan recovery).
///
/// An empty input slice returns an empty plan.
#[must_use]
pub fn recover_orphans(tasks: &[Task]) -> Vec<OrphanRecoveryPlan> {
    tasks
        .iter()
        .filter(|task| task.status == TaskStatus::InProgress)
        .map(|task| OrphanRecoveryPlan {
            task_id: task.task_id,
            current_status: task.status,
            target_status: TaskStatus::Ready,
            reason: ORPHAN_RECOVERY_REASON,
        })
        .collect()
}

/// Compute the set of cross-run retry plans for `tasks`.
///
/// Companion to [`recover_orphans`] (Section E): every task observed
/// in [`TaskStatus::Failed`] is a candidate for an auto-retry hop
/// back to [`TaskStatus::Ready`] so the scheduler picks it up again
/// on the next tick. Without this sweep, a task that ended a prior
/// run in `Failed` (e.g. an Anthropic 400 crash) stays `Failed`
/// forever — the scheduler only dispatches `Ready` tasks, so the
/// transient cause never gets a second chance.
///
/// Gating: each candidate is fed through
/// [`TaskRetryTracker::record_failure`] (the same tracker the
/// in-loop `task_failed` arm of `side_effects` already consults), so
/// the budget defined by
/// [`crate::budget::task_retry::TASK_LEVEL_RETRY_BUDGET`] applies
/// uniformly to in-run failures and cross-run failures. A
/// [`RetryDecision::Retry`] result emits a plan with
/// `current_status: Failed`, `target_status: Ready`, and reason
/// [`FAILED_RETRY_REASON`]. A [`RetryDecision::GiveUp`] result
/// leaves the task in `Failed` — no plan is emitted.
///
/// **Side effect**: this function MUTATES `tracker`. Each candidate
/// task bumps its per-task counter by one, exactly as if a
/// `task_failed` event had arrived in-loop. This is intentional: the
/// tracker is the only place we know how many attempts have happened
/// across the loop boundary, and treating the cross-run sweep as
/// just-another-failure keeps the budget arithmetic uniform with the
/// live path. Callers that care about idempotency (e.g. tests) can
/// pre-bump the tracker to drive specific decisions, or read
/// [`TaskRetryTracker::attempts`] before/after the call.
///
/// Tasks not in [`TaskStatus::Failed`] are ignored — see
/// [`recover_orphans`] for the `InProgress` case. Other states
/// (`Done`, `Blocked`, `Pending`, `Ready`, `Backlog`, `ToDo`) are
/// untouched. Empty input returns an empty plan.
#[must_use]
pub fn recover_failed(tasks: &[Task], tracker: &TaskRetryTracker) -> Vec<OrphanRecoveryPlan> {
    tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Failed)
        .filter_map(|task| match tracker.record_failure(task.task_id) {
            RetryDecision::Retry { .. } => Some(OrphanRecoveryPlan {
                task_id: task.task_id,
                current_status: task.status,
                target_status: TaskStatus::Ready,
                reason: FAILED_RETRY_REASON,
            }),
            RetryDecision::GiveUp => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use aura_os_core::{ProjectId, SpecId};
    use chrono::Utc;

    fn task_in(status: TaskStatus) -> Task {
        // Inlined fixture so the production-only Cargo deps stay
        // minimal: enabling `aura-os-core/test-utils` from this
        // crate's dev-dependencies would pull in `tempfile` for
        // every cargo test run even though the resilience suite
        // does not touch the filesystem.
        let now = Utc::now();
        Task {
            task_id: TaskId::new(),
            project_id: ProjectId::new(),
            spec_id: SpecId::new(),
            title: String::new(),
            description: String::new(),
            status,
            order_index: 0,
            dependency_ids: vec![],
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: vec![],
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn empty_input_returns_empty_plan() {
        assert!(recover_orphans(&[]).is_empty());
    }

    #[test]
    fn picks_only_in_progress_tasks() {
        let tasks = vec![
            task_in(TaskStatus::Pending),
            task_in(TaskStatus::Ready),
            task_in(TaskStatus::InProgress),
            task_in(TaskStatus::Done),
            task_in(TaskStatus::Failed),
            task_in(TaskStatus::Blocked),
        ];
        let plans = recover_orphans(&tasks);
        assert_eq!(
            plans.len(),
            1,
            "exactly one InProgress task must be recovered"
        );
        let plan = plans[0];
        assert_eq!(plan.current_status, TaskStatus::InProgress);
        assert_eq!(plan.target_status, TaskStatus::Ready);
        assert_eq!(plan.reason, ORPHAN_RECOVERY_REASON);
    }

    #[test]
    fn returns_one_plan_per_orphan() {
        let tasks = vec![
            task_in(TaskStatus::InProgress),
            task_in(TaskStatus::InProgress),
            task_in(TaskStatus::Done),
            task_in(TaskStatus::InProgress),
        ];
        let plans = recover_orphans(&tasks);
        assert_eq!(plans.len(), 3, "every InProgress task gets its own plan");
        for plan in &plans {
            assert_eq!(plan.target_status, TaskStatus::Ready);
        }
    }

    #[test]
    fn ignores_backlog_and_todo_states_too() {
        let tasks = vec![task_in(TaskStatus::Backlog), task_in(TaskStatus::ToDo)];
        assert!(recover_orphans(&tasks).is_empty());
    }
}

#[cfg(test)]
mod failed_tests {
    //! Cross-run [`recover_failed`] sweep. Mirrors the
    //! [`super::tests`] table for `recover_orphans` but with the
    //! added budget-gating dimension (the tracker mutates).

    use super::*;
    use crate::budget::task_retry::TASK_LEVEL_RETRY_BUDGET;

    use aura_os_core::{ProjectId, SpecId};
    use chrono::Utc;

    fn task_in(status: TaskStatus) -> Task {
        let now = Utc::now();
        Task {
            task_id: TaskId::new(),
            project_id: ProjectId::new(),
            spec_id: SpecId::new(),
            title: String::new(),
            description: String::new(),
            status,
            order_index: 0,
            dependency_ids: vec![],
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: vec![],
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn recover_failed_picks_only_failed_tasks() {
        let tracker = TaskRetryTracker::new();
        let failed = task_in(TaskStatus::Failed);
        let tasks = vec![
            task_in(TaskStatus::Pending),
            task_in(TaskStatus::Ready),
            task_in(TaskStatus::InProgress),
            task_in(TaskStatus::Done),
            failed.clone(),
            task_in(TaskStatus::Blocked),
            task_in(TaskStatus::Backlog),
            task_in(TaskStatus::ToDo),
        ];
        let plans = recover_failed(&tasks, &tracker);
        assert_eq!(
            plans.len(),
            1,
            "exactly one Failed task must be selected; got {plans:?}",
        );
        let plan = plans[0];
        assert_eq!(plan.task_id, failed.task_id);
        assert_eq!(plan.current_status, TaskStatus::Failed);
        assert_eq!(plan.target_status, TaskStatus::Ready);
        assert_eq!(plan.reason, FAILED_RETRY_REASON);
    }

    #[test]
    fn recover_failed_respects_retry_budget() {
        let tracker = TaskRetryTracker::new();
        let under_budget = task_in(TaskStatus::Failed);
        let over_budget = task_in(TaskStatus::Failed);

        // Pre-bump `over_budget` so the next `record_failure` from
        // `recover_failed` returns `GiveUp` (post-increment count
        // exceeds `TASK_LEVEL_RETRY_BUDGET`). `under_budget` starts
        // fresh and must produce a plan.
        for _ in 0..TASK_LEVEL_RETRY_BUDGET {
            assert_eq!(
                tracker.record_failure(over_budget.task_id),
                RetryDecision::Retry {
                    attempt: tracker.attempts(over_budget.task_id),
                },
            );
        }

        let tasks = vec![under_budget.clone(), over_budget.clone()];
        let plans = recover_failed(&tasks, &tracker);
        assert_eq!(plans.len(), 1, "only the under-budget task gets a plan");
        assert_eq!(plans[0].task_id, under_budget.task_id);
    }

    #[test]
    fn recover_failed_bumps_tracker_state() {
        let tracker = TaskRetryTracker::new();
        let failed = task_in(TaskStatus::Failed);
        assert_eq!(
            tracker.attempts(failed.task_id),
            0,
            "pre-condition: fresh tracker has no recorded failures",
        );
        let _ = recover_failed(std::slice::from_ref(&failed), &tracker);
        assert_eq!(
            tracker.attempts(failed.task_id),
            1,
            "recover_failed must call tracker.record_failure exactly once per Failed task",
        );
    }

    #[test]
    fn recover_failed_distinct_from_orphan_recovery() {
        let tracker = TaskRetryTracker::new();
        let in_progress = task_in(TaskStatus::InProgress);
        let failed = task_in(TaskStatus::Failed);
        let tasks = vec![in_progress.clone(), failed.clone()];

        let orphan_plans = recover_orphans(&tasks);
        let failed_plans = recover_failed(&tasks, &tracker);

        assert_eq!(orphan_plans.len(), 1);
        assert_eq!(failed_plans.len(), 1);
        assert_eq!(orphan_plans[0].task_id, in_progress.task_id);
        assert_eq!(failed_plans[0].task_id, failed.task_id);
        assert_ne!(
            orphan_plans[0].task_id, failed_plans[0].task_id,
            "the two sweeps must not double-cover any single task",
        );
        assert_eq!(orphan_plans[0].reason, ORPHAN_RECOVERY_REASON);
        assert_eq!(failed_plans[0].reason, FAILED_RETRY_REASON);
        assert_ne!(
            orphan_plans[0].reason, failed_plans[0].reason,
            "reasons must be distinguishable in logs",
        );
    }

    #[test]
    fn failed_retry_reason_constant_is_distinct_from_orphan() {
        assert_ne!(
            FAILED_RETRY_REASON, ORPHAN_RECOVERY_REASON,
            "log lines for the two sweeps must be distinguishable by reason string",
        );
        assert!(!FAILED_RETRY_REASON.is_empty());
    }

    #[test]
    fn recover_failed_empty_input_returns_empty_plan() {
        let tracker = TaskRetryTracker::new();
        assert!(recover_failed(&[], &tracker).is_empty());
        // No mutation either — an empty input must not bump any
        // counters (there is nothing to bump).
    }
}
