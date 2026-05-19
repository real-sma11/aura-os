//! Cross-module smoke tests for the resilience surface.
//!
//! Each submodule (`tool_retry`, `task_retry`, `orphan`) carries
//! its own colocated `#[cfg(test)]` block covering the behavioural
//! detail. The tests here pin the **re-export surface** so a
//! downstream import like
//! `aura_os_automation::resilience::{ToolRetryTracker, RetryDecision}`
//! cannot silently break when a submodule renames a symbol.

use super::{
    recover_failed, recover_orphans, OrphanRecoveryPlan, RetryDecision, TaskRetryTracker,
    ToolRetryTracker, FAILED_RETRY_REASON, ORPHAN_RECOVERY_REASON,
};

#[test]
fn re_export_surface_compiles_via_module_root() {
    let _ = ToolRetryTracker::new();
    let task_tracker = TaskRetryTracker::new();
    let _ = RetryDecision::GiveUp;
    let _: Vec<OrphanRecoveryPlan> = recover_orphans(&[]);
    let _: Vec<OrphanRecoveryPlan> = recover_failed(&[], &task_tracker);
    assert!(!ORPHAN_RECOVERY_REASON.is_empty());
    assert!(!FAILED_RETRY_REASON.is_empty());
    assert_ne!(ORPHAN_RECOVERY_REASON, FAILED_RETRY_REASON);
}
