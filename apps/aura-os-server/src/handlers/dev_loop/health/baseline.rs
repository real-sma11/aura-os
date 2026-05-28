//! Per-task workspace-health baseline tracker.
//!
//! Stashes the [`WorkspaceHealth`] fingerprint captured at
//! `task_started` so the completion gate can re-read it at
//! `task_done` and call [`super::classify_delta`] against it.
//!
//! The tracker is intentionally a passive store: it does not invoke
//! `cargo check`, schedule snapshots, or know about timeouts. The
//! App-layer snapshot runner (`signals::health_snapshot`) owns the
//! shell-out and calls [`HealthBaselineTracker::record`] with whatever
//! [`WorkspaceHealth`] it produced — including
//! [`WorkspaceHealth::unknown`] when the snapshot bailed.
//!
//! Internal poison-recovery: on a poisoned mutex we take the inner
//! state and keep going. The worst case for a missed baseline is
//! "the completion gate sees no baseline and falls through to the
//! existing path", which is strictly safer than panicking through
//! the forwarder.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use aura_os_core::TaskId;

use super::types::WorkspaceHealth;

/// One stashed baseline entry. The `captured_at` timestamp lets the
/// completion gate decide whether the baseline is fresh enough to
/// trust before reusing it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BaselineEntry {
    /// The captured `WorkspaceHealth` fingerprint at task start.
    pub health: WorkspaceHealth,
    /// Wall-clock instant the baseline was recorded.
    pub captured_at: SystemTime,
}

/// In-memory store of per-task baseline snapshots keyed by
/// [`TaskId`]. `Default` + `Send` + `Sync` so the server can wrap it
/// in an `Arc` and pass it through the per-loop `LoopRetryState`.
#[derive(Debug, Default)]
pub(crate) struct HealthBaselineTracker {
    baselines: Mutex<HashMap<TaskId, BaselineEntry>>,
}

impl HealthBaselineTracker {
    /// Construct an empty tracker.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Stash a [`WorkspaceHealth`] baseline for `task_id`. Overwrites
    /// any prior entry — re-snapshotting the same task (e.g. via the
    /// task-level retry path) replaces the stale fingerprint.
    pub fn record(&self, task_id: TaskId, health: WorkspaceHealth) {
        let mut baselines = self.locked_baselines();
        baselines.insert(
            task_id,
            BaselineEntry {
                health,
                captured_at: SystemTime::now(),
            },
        );
    }

    /// Read the baseline for `task_id` if one was recorded.
    ///
    /// Returns a clone so callers don't have to hold the internal
    /// mutex while pattern-matching on the verdict. `BaselineEntry`
    /// is cheap to clone (a `WorkspaceHealth` plus a `SystemTime`).
    #[must_use]
    pub fn get(&self, task_id: TaskId) -> Option<BaselineEntry> {
        let baselines = self.locked_baselines();
        baselines.get(&task_id).cloned()
    }

    /// Drop the baseline for `task_id`. Called from the
    /// `task_completed` / `task_failed` arms so a rerun of the same
    /// task starts from a fresh snapshot rather than inheriting a
    /// stale baseline. No-op when the task has no recorded baseline.
    pub fn clear(&self, task_id: TaskId) {
        let mut baselines = self.locked_baselines();
        baselines.remove(&task_id);
    }

    /// Wall-clock age of the baseline for `task_id`, when one is
    /// present and the system clock hasn't gone backwards since the
    /// snapshot was taken. Returns `None` when the task is untracked
    /// or [`SystemTime::elapsed`] errors out (the latter only happens
    /// when the system clock moves backwards across the snapshot
    /// instant, which is rare enough to treat as "untracked" without
    /// surfacing the error).
    #[must_use]
    #[allow(dead_code)]
    pub fn snapshot_age(&self, task_id: TaskId) -> Option<Duration> {
        let baselines = self.locked_baselines();
        let entry = baselines.get(&task_id)?;
        entry.captured_at.elapsed().ok()
    }

    fn locked_baselines(&self) -> std::sync::MutexGuard<'_, HashMap<TaskId, BaselineEntry>> {
        match self.baselines.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::{BuildStatus, HealthError, TestStatus};
    use super::*;

    fn failing_health() -> WorkspaceHealth {
        WorkspaceHealth {
            build_status: BuildStatus::Failing {
                errors: vec![HealthError {
                    file: "crates/foo/src/lib.rs".into(),
                    code: Some("E0277".into()),
                    kind: "trait not implemented".into(),
                }],
            },
            test_status: TestStatus::Unknown,
        }
    }

    #[test]
    fn record_then_get_round_trips_the_health_value() {
        let tracker = HealthBaselineTracker::new();
        let task = TaskId::new();
        let baseline = WorkspaceHealth::clean();
        tracker.record(task, baseline.clone());
        let entry = tracker.get(task).expect("baseline must be present");
        assert_eq!(entry.health, baseline);
    }

    #[test]
    fn record_overwrites_any_prior_entry_for_the_same_task() {
        let tracker = HealthBaselineTracker::new();
        let task = TaskId::new();
        tracker.record(task, failing_health());
        tracker.record(task, WorkspaceHealth::clean());
        let entry = tracker.get(task).expect("re-record must keep an entry");
        assert_eq!(
            entry.health,
            WorkspaceHealth::clean(),
            "the latest record must win"
        );
    }

    #[test]
    fn get_returns_none_when_task_has_no_baseline() {
        let tracker = HealthBaselineTracker::new();
        assert!(tracker.get(TaskId::new()).is_none());
    }

    #[test]
    fn clear_removes_the_entry_so_subsequent_gets_return_none() {
        let tracker = HealthBaselineTracker::new();
        let task = TaskId::new();
        tracker.record(task, WorkspaceHealth::clean());
        assert!(tracker.get(task).is_some());
        tracker.clear(task);
        assert!(
            tracker.get(task).is_none(),
            "clear must drop the entry for {task}",
        );
    }

    #[test]
    fn clear_unknown_task_is_a_no_op() {
        let tracker = HealthBaselineTracker::new();
        tracker.clear(TaskId::new());
    }

    #[test]
    fn snapshot_age_reports_a_non_negative_duration_for_tracked_tasks() {
        let tracker = HealthBaselineTracker::new();
        let task = TaskId::new();
        tracker.record(task, WorkspaceHealth::clean());
        let age = tracker.snapshot_age(task).expect("age must be present");
        // A baseline recorded a moment ago must be observed as a
        // finite duration. Duration is unsigned so any value (including
        // zero) is non-negative; the assertion just pins that the
        // tracker returns *some* age rather than `None`.
        assert!(age < Duration::from_secs(10), "age too large: {age:?}");
    }

    #[test]
    fn snapshot_age_returns_none_for_untracked_tasks() {
        let tracker = HealthBaselineTracker::new();
        assert!(tracker.snapshot_age(TaskId::new()).is_none());
    }

    #[test]
    fn distinct_tasks_keep_independent_baselines() {
        let tracker = HealthBaselineTracker::new();
        let task_a = TaskId::new();
        let task_b = TaskId::new();
        tracker.record(task_a, WorkspaceHealth::clean());
        tracker.record(task_b, failing_health());
        assert_eq!(
            tracker.get(task_a).unwrap().health,
            WorkspaceHealth::clean(),
        );
        assert_eq!(tracker.get(task_b).unwrap().health, failing_health());
        tracker.clear(task_a);
        assert!(tracker.get(task_a).is_none());
        assert!(
            tracker.get(task_b).is_some(),
            "clearing task_a must not touch task_b",
        );
    }
}
