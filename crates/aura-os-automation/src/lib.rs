//! Domain logic for dev-loop and chat agent automation.
//!
//! This crate owns the pure logic that the dev-loop, the chat agent,
//! and (later) other automation surfaces share. It has no Axum, no
//! [`aura_os_server`] state, no [`aura_os_storage`] dependency, and
//! no [`anyhow`] in its library surface — failures travel through
//! the [`AutomationError`] enum.
//!
//! After Phase 4 of the dev-loop simplification the surface is:
//!
//! * `progress/` — spinner/activity mapping.
//! * `failure/` — fallback `task_failed` reason synthesis.
//! * `resilience/health_baseline` — per-task `WorkspaceHealth`
//!   baseline tracker for the surviving workspace-health completion
//!   gate. The retry trackers and orphan-recovery planner that used
//!   to live next door were deleted in Phase 4 — the persisted
//!   `tasks.attempts` column plus a single startup `Running ->
//!   Ready` sweep replace them.
//! * `task_context/` — cached resolver + pure builder for the
//!   `get_task_context` tool's wire payload.
//! * `classify/` — `classify_push_failure` shim (everything else
//!   in the classify family was deleted in Phase 1).
//! * `health/` — workspace-health diff gate; owns
//!   `format_health_summary` since Phase 4 (moved from the deleted
//!   `budget/exploration` module).

#![warn(missing_docs)]

pub mod classify;
pub mod error;
pub mod event_kinds;
pub mod failure;
pub mod health;
pub mod progress;
pub mod resilience;
pub mod task_context;

pub use classify::classify_push_failure;
pub use error::AutomationError;
pub use failure::{synthesize_failure_reason, FailureContext};
// Re-export the pure types + classification surface the App layer
// wires into the task-claim snapshot and the `task_done` completion
// gate.
pub use health::{
    classify_delta, contains_workspace_health_blocking_reason, format_health_summary,
    is_workspace_health_blocking_reason, parse_cargo_check_json_output, BuildStatus, HealthDelta,
    HealthError, HealthVerdict, TestStatus, WorkspaceHealth, REASON_CLEAN, REASON_IMPROVED,
    REASON_REGRESSED, REASON_UNCHANGED, WORKSPACE_HEALTH_BLOCKING_REASONS,
};
pub use progress::{apply_loop_activity, LoopActivityTransition};
pub use resilience::{BaselineEntry, HealthBaselineTracker};
pub use task_context::{
    build_task_context, TaskContext, TaskContextCache, TaskContextInputs, TaskContextResolver,
    TaskRef, MAX_CACHE_ENTRIES, MAX_EXECUTION_NOTES_LEN,
};

#[cfg(test)]
mod smoke {
    //! Compile-time check that the documented public re-export shape
    //! resolves. Catches accidental renames before downstream crates
    //! see them.

    #[test]
    fn public_reexports_resolve() {
        let _ = crate::classify_push_failure("git push timed out");
        let _: &str = crate::event_kinds::TEXT_DELTA;
        // Compile-time check that `apply_loop_activity` is reachable
        // through the crate root. The progress module's own table
        // tests cover behaviour; here we just want a `let _ = ...`
        // that pins the public name.
        fn _assert_callable(
            activity: &aura_os_events::LoopActivity,
        ) -> Option<crate::LoopActivityTransition> {
            crate::apply_loop_activity(activity, crate::event_kinds::TEXT_DELTA)
        }
        let _ = crate::synthesize_failure_reason(&crate::FailureContext::default());
        let _resolver = crate::TaskContextResolver::new();
        let _cache = crate::TaskContextCache::new();
        let _ref_cap: usize = crate::MAX_CACHE_ENTRIES;
        let _notes_cap: usize = crate::MAX_EXECUTION_NOTES_LEN;
        // Make sure the wire types compose into the tool-result JSON.
        let task = dummy_task();
        let inputs = crate::TaskContextInputs {
            task: &task,
            parent: None,
            children: &[],
            spec: None,
            task_version: 0,
        };
        let ctx = crate::build_task_context(&inputs);
        let _: crate::TaskContext = ctx;
        let _ref_type: Option<crate::TaskRef> = None;
        // Pin the simplified health-module public names so accidental
        // renames blow up here before the App layer wires them up.
        let _errors: Vec<crate::HealthError> = crate::parse_cargo_check_json_output("");
        let _baseline: crate::WorkspaceHealth = crate::WorkspaceHealth::clean();
        let _current: crate::WorkspaceHealth = crate::WorkspaceHealth::clean();
        let _delta: crate::HealthDelta = crate::classify_delta(&_baseline, &_current);
        let _verdict: crate::HealthVerdict = _delta.verdict;
        let _blocks: bool = _verdict.blocks_task_done();
        let _: bool = crate::is_workspace_health_blocking_reason(_delta.reason);
        let _: bool = crate::contains_workspace_health_blocking_reason(
            "agent execution error: workspace_health_regressed at task_done",
        );
        let _: &[&str] = crate::WORKSPACE_HEALTH_BLOCKING_REASONS;
        let _: crate::BuildStatus = crate::BuildStatus::Passing;
        let _: crate::BuildStatus = crate::BuildStatus::Unknown;
        let _: crate::TestStatus = crate::TestStatus::Unknown;
        let _: crate::WorkspaceHealth = crate::WorkspaceHealth::unknown();
        let _baseline_tracker = crate::HealthBaselineTracker::new();
        let _baseline_task = aura_os_core::TaskId::new();
        _baseline_tracker.record(_baseline_task, crate::WorkspaceHealth::clean());
        let _entry: Option<crate::BaselineEntry> = _baseline_tracker.get(_baseline_task);
        _baseline_tracker.clear(_baseline_task);
        let _age: Option<std::time::Duration> = _baseline_tracker.snapshot_age(_baseline_task);
        // `format_health_summary` survived Phase 4 (moved from the
        // deleted budget/exploration module into the health module).
        let _summary: String = crate::format_health_summary(&crate::WorkspaceHealth::clean());
    }

    fn dummy_task() -> aura_os_core::Task {
        let now = chrono::Utc::now();
        aura_os_core::Task {
            task_id: aura_os_core::TaskId::new(),
            project_id: aura_os_core::ProjectId::new(),
            spec_id: aura_os_core::SpecId::new(),
            title: String::new(),
            description: String::new(),
            status: aura_os_core::TaskStatus::Ready,
            order_index: 0,
            dependency_ids: Vec::new(),
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: Vec::new(),
            live_output: String::new(),
            build_steps: Vec::new(),
            test_steps: Vec::new(),
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            attempts: 0,
            created_at: now,
            updated_at: now,
        }
    }
}
