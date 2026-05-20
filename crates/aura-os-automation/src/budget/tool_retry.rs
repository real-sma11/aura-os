//! Per-task budget for `tool_call_failed` infra-retries.
//!
//! The dev-loop forwarder restarts the harness's per-tool-call infra
//! retry path up to this many times for a single task before giving up
//! and letting the failure propagate. The server-side budget is now
//! deliberately larger than the harness's own streaming-retry count so
//! transient provider/tool failures get enough runway on long tasks.

/// Maximum number of infra-retry restarts the dev-loop forwarder will
/// issue for a single task in response to `tool_call_failed` events.
///
/// Intentionally exceeds the harness's internal streaming-retry
/// budget. See the regression in
/// `apps/aura-os-server/tests/dev_loop_dod_regression/retry.rs`.
pub const TOOL_CALL_RETRY_BUDGET: u32 = 16;
