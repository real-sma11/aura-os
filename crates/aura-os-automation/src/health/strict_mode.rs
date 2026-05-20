//! Environment-knob plumbing for the workspace-health diff gate.
//!
//! Phase 1 of `workspace-health-diff-gate`. Two knobs:
//!
//! * `AURA_BLOCK_TASK_DONE_ON_ANY_WORKSPACE_RED` — when set to one of
//!   `1` / `true` / `yes` / `on` (case + whitespace insensitive),
//!   doc/refactor/verification tasks are blocked from `task_done`
//!   while the workspace is red. Default OFF preserves today's
//!   behavior; operators opt in to the 3.9-style strict policy.
//! * `AURA_HEALTH_BASELINE_REUSE_MAX_AGE_SECS` — max age (seconds)
//!   of the most-recent `build_preflight` snapshot the App layer can
//!   reuse as a baseline before falling back to a fresh background
//!   snapshot. Default 600 (10 minutes); set to `0` for force-fresh
//!   rigor-over-latency.
//!
//! The string-parsing pattern mirrors
//! `apps/aura-os-server/src/handlers/dev_loop/signals/classifiers.rs`'s
//! `auto_decompose_disabled` helper so operators see consistent env-flag
//! semantics across the dev-loop.

/// Default for `AURA_HEALTH_BASELINE_REUSE_MAX_AGE_SECS` (10 minutes).
/// Public so the App layer can reference the same constant in its
/// reuse-then-background-snapshot strategy.
pub const DEFAULT_BASELINE_REUSE_MAX_AGE_SECS: u64 = 600;

/// True when `AURA_BLOCK_TASK_DONE_ON_ANY_WORKSPACE_RED` is set to a
/// truthy value (`1`, `true`, `yes`, `on`). All other values (including
/// unset, empty, and explicit `0` / `false`) return `false`.
#[must_use]
pub fn is_strict_mode_enabled() -> bool {
    std::env::var("AURA_BLOCK_TASK_DONE_ON_ANY_WORKSPACE_RED")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Resolve `AURA_HEALTH_BASELINE_REUSE_MAX_AGE_SECS` into a `u64`. An
/// unset or unparseable value falls back to
/// [`DEFAULT_BASELINE_REUSE_MAX_AGE_SECS`]. A value of `0` is honored
/// verbatim — that's the force-fresh path.
#[must_use]
pub fn baseline_reuse_max_age_secs() -> u64 {
    std::env::var("AURA_HEALTH_BASELINE_REUSE_MAX_AGE_SECS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_BASELINE_REUSE_MAX_AGE_SECS)
}
