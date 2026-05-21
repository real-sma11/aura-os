//! Server-side classifier wrappers that route reason strings through the typed
//! [`HarnessFailureKind`] enum exported by `aura-os-harness::signals`.
//!
//! Every server-side gate parses the reason string through
//! `HarnessSignal::from_event(...).failure_kind()` so the typed enum is
//! the single source of truth.

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
/// by the typed classifier — the safety net behind the
/// `debug.retry_miss` trigger condition in
/// `autonomous_recovery_replay/classifiers.rs`.
///
/// Production retry decisions consume [`HarnessFailureKind`] directly
/// through [`HarnessFailureKind::is_retryable`]; this safety-net
/// heuristic only exists to keep the long-standing regression
/// coverage in place while the wider clean-up (Phase 4 of the plan)
/// is pending.
pub(crate) fn looks_like_unclassified_transient(reason: &str) -> bool {
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

pub(crate) fn is_truncation_failure(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::Truncation)
}

pub(crate) fn is_completion_contract_failure(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::CompletionContract)
}

pub(crate) fn is_rate_limited_failure(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::RateLimited)
}

pub(crate) fn is_insufficient_credits_failure(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::InsufficientCredits)
}

pub(crate) fn is_git_push_timeout_failure(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::PushTimeout)
}

pub(crate) fn is_provider_internal_error(reason: &str) -> bool {
    matches_kind(reason, HarnessFailureKind::ProviderInternal)
}

pub(crate) fn is_agent_stuck_terminal_signal(reason: &str) -> bool {
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
pub(crate) fn should_restart_on_error_event(reason: &str) -> bool {
    let kind = failure_kind_of(reason);
    if matches!(kind, HarnessFailureKind::AgentStuck) {
        return false;
    }
    // Treat `Truncation` / `CompletionContract` as "task-shape" rather
    // than restartable error events here: the harness has already
    // emitted a structured `task_failed` for those and the
    // task-level retry path handles them, so restarting the entire
    // automaton would just double-spend the budget. The other
    // retryable kinds (`RateLimited`, `ProviderInternal`,
    // `PushTimeout`, `ResearchLoopAbort`) are infra-transient and
    // benefit from a fresh streaming attempt.
    let restart_eligible = matches!(
        kind,
        HarnessFailureKind::RateLimited
            | HarnessFailureKind::ProviderInternal
            | HarnessFailureKind::PushTimeout
            | HarnessFailureKind::ResearchLoopAbort,
    );
    restart_eligible || looks_like_unclassified_transient(reason)
}
