//! Canonical harness wire-event-type strings consumed by the dev-loop
//! progress mapper.
//!
//! These mirror the constants in
//! `crates/aura-os-harness/src/runner/automaton_event_kinds.rs`
//! byte-for-byte. The `event_kinds_match_harness_constants` test in
//! the colocated `tests` module asserts the equivalence at every
//! `cargo test -p aura-os-server` so the duplication cannot drift
//! silently.

/// `text_delta` — incremental assistant text output.
pub(crate) const TEXT_DELTA: &str = "text_delta";

/// `thinking_delta` — incremental assistant scratchpad output.
pub(crate) const THINKING_DELTA: &str = "thinking_delta";

/// `tool_use_start` — assistant decided to invoke a tool. The event
/// payload carries the tool name in `tool` (or, on some harness
/// builds, `name`).
pub(crate) const TOOL_USE_START: &str = "tool_use_start";

/// `tool_call_started` — alias the harness emits for some tool kinds;
/// semantically identical to [`TOOL_USE_START`] for the progress
/// mapper.
pub(crate) const TOOL_CALL_STARTED: &str = "tool_call_started";

/// `tool_call_snapshot` — incremental update on an in-flight tool
/// call. High-frequency; the progress mapper deliberately ignores it
/// to avoid flooding the activity broadcast.
pub(crate) const TOOL_CALL_SNAPSHOT: &str = "tool_call_snapshot";

/// `tool_call_completed` — terminal event for a tool call's lifecycle
/// (the assistant has the result).
pub(crate) const TOOL_CALL_COMPLETED: &str = "tool_call_completed";

/// `tool_result` — the actual tool result block delivered to the
/// assistant.
pub(crate) const TOOL_RESULT: &str = "tool_result";

/// `token_usage` — incremental token usage update.
pub(crate) const TOKEN_USAGE: &str = "token_usage";

/// `assistant_message_end` — terminal event for one assistant turn.
pub(crate) const ASSISTANT_MESSAGE_END: &str = "assistant_message_end";

/// `usage` — full-stream token usage rollup emitted alongside
/// `assistant_message_end` on some harness builds.
pub(crate) const USAGE: &str = "usage";

/// `session_usage` — session-scoped token usage rollup.
pub(crate) const SESSION_USAGE: &str = "session_usage";

/// `task_completed` — task-level success terminal event.
pub(crate) const TASK_COMPLETED: &str = "task_completed";

/// `task_failed` — task-level failure terminal event.
pub(crate) const TASK_FAILED: &str = "task_failed";

/// `done` — automaton-stream success terminal event.
pub(crate) const DONE: &str = "done";

/// `error` — automaton-stream error terminal event.
pub(crate) const ERROR: &str = "error";

/// `git_committed` — successful commit emitted by the harness sync
/// path.
pub(crate) const GIT_COMMITTED: &str = "git_committed";

/// `git_commit_failed` — failed commit attempt.
pub(crate) const GIT_COMMIT_FAILED: &str = "git_commit_failed";

/// `git_pushed` — successful push.
pub(crate) const GIT_PUSHED: &str = "git_pushed";

/// `git_push_failed` — failed push attempt.
pub(crate) const GIT_PUSH_FAILED: &str = "git_push_failed";

#[cfg(test)]
mod tests {
    //! Test-only invariant: every constant here must equal its
    //! counterpart in `aura_os_harness::runner::automaton_event_kinds`
    //! byte-for-byte.

    use super::*;
    use aura_os_harness::runner::automaton_event_kinds as harness;

    #[test]
    fn event_kinds_match_harness_constants() {
        assert_eq!(TEXT_DELTA, harness::TEXT_DELTA);
        assert_eq!(THINKING_DELTA, harness::THINKING_DELTA);
        assert_eq!(TOOL_USE_START, harness::TOOL_USE_START);
        assert_eq!(TOOL_CALL_STARTED, harness::TOOL_CALL_STARTED);
        assert_eq!(TOOL_CALL_SNAPSHOT, harness::TOOL_CALL_SNAPSHOT);
        assert_eq!(TOOL_CALL_COMPLETED, harness::TOOL_CALL_COMPLETED);
        assert_eq!(TOOL_RESULT, harness::TOOL_RESULT);
        assert_eq!(TOKEN_USAGE, harness::TOKEN_USAGE);
        assert_eq!(ASSISTANT_MESSAGE_END, harness::ASSISTANT_MESSAGE_END);
        assert_eq!(USAGE, harness::USAGE);
        assert_eq!(SESSION_USAGE, harness::SESSION_USAGE);
        assert_eq!(TASK_COMPLETED, harness::TASK_COMPLETED);
        assert_eq!(TASK_FAILED, harness::TASK_FAILED);
        assert_eq!(DONE, harness::DONE);
        assert_eq!(ERROR, harness::ERROR);
        assert_eq!(GIT_COMMITTED, harness::GIT_COMMITTED);
        assert_eq!(GIT_COMMIT_FAILED, harness::GIT_COMMIT_FAILED);
        assert_eq!(GIT_PUSHED, harness::GIT_PUSHED);
        assert_eq!(GIT_PUSH_FAILED, harness::GIT_PUSH_FAILED);
    }
}
