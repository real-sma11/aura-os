//! Thin wrappers that route the legacy `signals::*_for_tests` helpers
//! through the typed [`HarnessFailureKind`] enum exported by
//! `aura-os-harness::signals`.
//!
//! Phase 1 of `simplify dev-loop / harness automation`: the substring
//! classifier family in `aura-os-automation::classify::transient` has
//! been deleted; every server-side gate now parses the reason string
//! through `HarnessSignal::from_event(...).failure_kind()` so the
//! typed enum is the single source of truth. The `*_for_tests` shims
//! preserve their original signatures so downstream `phase7_test_support`
//! callers (the `dev_loop_dod_regression` + `autonomous_recovery_replay`
//! suites) keep compiling unchanged.

use aura_os_harness::signals::{HarnessFailureKind, HarnessSignal};

/// True when a `task_failed` reason classifies as `kind` through the
/// canonical [`aura_os_harness::signals::classify_failure`] router.
///
/// Wrapper around `HarnessSignal::from_event("task_failed", ...)` so
/// callers stay one line and don't accidentally diverge from the
/// harness's classifier ordering (which encodes the
/// `AgentStuck > ResearchLoopAbort` precedence pinned by the harness
/// unit tests).
pub(crate) fn matches_kind(reason: &str, kind: HarnessFailureKind) -> bool {
    HarnessSignal::from_event("task_failed", &serde_json::json!({ "reason": reason }))
        .and_then(|signal| signal.failure_kind())
        == Some(kind)
}

/// Run the reason string through the harness classifier and return
/// the parsed [`HarnessFailureKind`]. Returns
/// [`HarnessFailureKind::Other`] when the synthetic event fails to
/// parse, mirroring the `classify_failure(None)` fallback.
pub(crate) fn failure_kind_of(reason: &str) -> HarnessFailureKind {
    HarnessSignal::from_event("task_failed", &serde_json::json!({ "reason": reason }))
        .and_then(|signal| signal.failure_kind())
        .unwrap_or(HarnessFailureKind::Other)
}

/// True when a transient-looking reason string was *not* picked up
/// by the typed classifier — the safety net the
/// `looks_like_unclassified_transient_for_tests` shim continues to
/// expose so the `debug.retry_miss` trigger condition in
/// `autonomous_recovery_replay/classifiers.rs` keeps firing.
///
/// Kept private to this module: production retry decisions consume
/// [`HarnessFailureKind`] directly through
/// [`HarnessFailureKind::is_retryable`]; the safety-net heuristic
/// only exists to preserve the long-standing `_for_tests` shim
/// semantics while the wider clean-up (Phase 4 of the plan) is
/// pending.
fn looks_like_unclassified_transient(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    [
        "timeout",
        "temporar",
        "connection reset",
        "econnreset",
        "dns lookup failed",
        "tls handshake",
        "socket hang up",
        "unavailable",
        "try again",
    ]
    .iter()
    .any(|needle| reason.contains(needle))
        && !matches!(
            failure_kind_of(&reason),
            HarnessFailureKind::RateLimited | HarnessFailureKind::ProviderInternal,
        )
}

pub(crate) fn auto_decompose_disabled() -> bool {
    std::env::var("AURA_AUTO_DECOMPOSE_DISABLED")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

pub(crate) fn is_truncation_failure_for_tests(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::Truncation)
}

pub(crate) fn is_completion_contract_failure_for_tests(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::CompletionContract)
}

pub(crate) fn is_rate_limited_failure_for_tests(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::RateLimited)
}

pub(crate) fn is_insufficient_credits_failure_for_tests(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::InsufficientCredits)
}

pub(crate) fn is_git_push_timeout_failure_for_tests(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::PushTimeout)
}

pub(crate) fn is_provider_internal_error_for_tests(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::ProviderInternal)
}

pub(crate) fn looks_like_unclassified_transient_for_tests(reason: &str) -> bool {
    looks_like_unclassified_transient(reason)
}

pub(crate) fn is_agent_stuck_terminal_signal_for_tests(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::AgentStuck)
}

/// Production-equivalent restart gate driven by the typed enum.
///
/// Mirrors the legacy `should_restart_on_error` semantics:
///
/// * `AgentStuck` → always reject (terminal anti-waste signal).
/// * Other retryable kinds (`RateLimited`, `ProviderInternal`,
///   `PushTimeout`, `ResearchLoopAbort`) → accept.
/// * Falls back to the [`looks_like_unclassified_transient`] safety
///   net so the `autonomous_recovery_replay/gates.rs` matrix's
///   "tls handshake", "socket hang up" rows still restart.
pub(crate) fn should_restart_on_error_event_for_tests(reason: &str) -> bool {
    let kind = failure_kind_of(reason);
    if matches!(kind, HarnessFailureKind::AgentStuck) {
        return false;
    }
    kind.is_retryable() || looks_like_unclassified_transient(reason)
}

pub(crate) fn tool_call_failed_should_retry_for_tests(reason: &str, prior_count: u32) -> bool {
    prior_count < aura_os_automation::TOOL_CALL_RETRY_BUDGET
        && should_restart_on_error_event_for_tests(reason)
}

pub(crate) const fn tool_call_retry_budget_for_tests() -> u32 {
    aura_os_automation::TOOL_CALL_RETRY_BUDGET
}

pub(crate) fn classify_push_failure_for_tests(reason: &str) -> Option<&'static str> {
    aura_os_automation::classify_push_failure(reason)
}
