//! Cross-cutting limits and timeouts for the dev-loop.
//!
//! Domain-specific literals stay co-located with their owners:
//! - `health/delta.rs` keeps `REASON_*` and `WORKSPACE_HEALTH_BLOCKING_REASONS`.
//! - `progress/activity.rs` keeps `STEP_THINKING` and `STEP_PROCESSING`.
//!
//! Use this file for the timeouts, polling intervals, and attempt budgets
//! that previously lived spread across `adapter/common.rs`, `registry.rs`,
//! `signals/health_snapshot.rs`, `streaming/side_effects/mod.rs`, and
//! `adapter/run_single.rs`.

use std::time::Duration;

/// Maximum lifetime of a dev-loop's harness event stream before the
/// forwarder times out. Sized for an idle long-lived loop.
pub(super) const LOOP_STREAM_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);

/// Maximum lifetime of a single-task harness event stream.
pub(super) const TASK_STREAM_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);

/// Adopt-shortcut freshness window: a harness automaton whose forwarder
/// has not received any event in this long is treated as wedged and
/// rebuilt from scratch on the next start.
pub(super) const FORWARDER_FRESHNESS_THRESHOLD: Duration = Duration::from_secs(120);

/// Hard wall-clock cap for a workspace-health `cargo check` snapshot,
/// sized for a cold-cache `task_started` run.
pub(super) const HEALTH_SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(120);

/// Polling interval for the ephemeral-executor reaper.
pub(super) const EPHEMERAL_REAPER_POLL: Duration = Duration::from_secs(15);

/// Backstop TTL for the ephemeral-executor reaper if the forwarder never
/// reports terminal status.
pub(super) const EPHEMERAL_REAPER_TTL: Duration = Duration::from_secs(8 * 60 * 60);

/// Per-task ceiling on auto-retry hops the dev-loop will issue from the
/// `task_failed` arm before leaving the task in `Failed` for good. Mirrored
/// against the persisted `tasks.attempts` column so the budget survives
/// server restarts.
pub(super) const MAX_TASK_ATTEMPTS: u32 = 3;

/// Number of times the harness-WS connector retries on initial connect
/// failure before bubbling the error.
pub(super) const HARNESS_CONNECT_RETRIES: u32 = 2;
