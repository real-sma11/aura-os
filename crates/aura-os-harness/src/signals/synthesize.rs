//! Pure synthesis of a fallback `task_failed` reason string.
//!
//! The dev-loop forwarder calls [`synthesize_failure_reason`] from
//! the `task_failed` arm in
//! `apps/aura-os-server/src/handlers/dev_loop/streaming/side_effects.rs`
//! whenever the standard reason fields (`reason`, `message`, `error`,
//! `code`) are all empty. Without this fallback the persisted
//! `Task.execution_notes` ended up blank and the UI showed
//! "Task failed without producing output" with nothing actionable
//! for the operator.
//!
//! The synthesizer itself is a small pure function — it owns no I/O
//! and no allocations beyond the returned `String`. The caller in
//! `side_effects.rs` builds a [`FailureContext`] from whatever
//! signal is locally available (the event payload, a recent tool
//! name cache, the live-output tail), then hands it to
//! [`synthesize_failure_reason`].

/// Maximum number of characters preserved from
/// [`FailureContext::last_error_excerpt`] before truncation. Picked
/// to comfortably fit a single grep line on a 200-column terminal
/// after the `error: ` prefix and the surrounding clauses.
pub const MAX_ERROR_EXCERPT_LEN: usize = 240;

/// Context bundle the caller assembles from whatever signal is
/// locally available at the `task_failed` arm. Every field is
/// `Option<String>` because in production the harness payload often
/// only carries a subset of them — the synthesizer degrades
/// gracefully when any are missing.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FailureContext {
    /// The reason string the caller already extracted from the
    /// event payload, if any. When `Some` and non-empty, the
    /// synthesizer returns it unchanged — the call site is supposed
    /// to short-circuit before invoking us, but we tolerate the
    /// belt-and-braces case so a caller cannot accidentally
    /// overwrite a real reason with a synthetic one.
    pub real_reason: Option<String>,
    /// Last `terminal_state` the loop forwarder observed for this
    /// task — typically derived from the harness's lifecycle
    /// snapshot or the local activity tracker.
    pub terminal_state: Option<String>,
    /// Name of the last tool the harness invoked before the
    /// `task_failed` arrived. Sourced from the side-effects worker's
    /// per-task state.
    pub last_tool_name: Option<String>,
    /// Tail of the last error-shaped string seen on the wire (e.g.
    /// from a `tool_result` payload with `is_error: true`).
    /// Truncated to [`MAX_ERROR_EXCERPT_LEN`] characters inside
    /// [`synthesize_failure_reason`] so callers can pass the raw
    /// value without pre-trimming.
    pub last_error_excerpt: Option<String>,
}

/// Synthesize a descriptive fallback `task_failed` reason from
/// [`FailureContext`].
///
/// Contract:
///
/// * If [`FailureContext::real_reason`] is `Some` and non-empty
///   after trimming, the trimmed value is returned unchanged.
/// * Otherwise the output is `"task failed: <terminal_state>"`
///   (defaulting to `"unknown"` when the state field is missing
///   too), optionally followed by `"; last tool <tool_name>"` and
///   `"; error: <truncated_excerpt>"` clauses for whichever extra
///   fields are present.
/// * The output is never empty. Even an all-`None` context yields
///   `"task failed: unknown"` so the persisted
///   `Task.execution_notes` always carries actionable text.
///
/// The function is `#[must_use]` so a caller cannot accidentally
/// drop the synthesized string on the floor.
#[must_use]
pub fn synthesize_failure_reason(ctx: &FailureContext) -> String {
    if let Some(reason) = ctx.real_reason.as_deref() {
        let trimmed = reason.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let state = ctx
        .terminal_state
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown");

    let mut parts = vec![format!("task failed: {state}")];

    if let Some(tool) = ctx
        .last_tool_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("last tool {tool}"));
    }

    if let Some(excerpt) = ctx.last_error_excerpt.as_deref() {
        let trimmed = excerpt.trim();
        if !trimmed.is_empty() {
            parts.push(format!(
                "error: {}",
                truncate(trimmed, MAX_ERROR_EXCERPT_LEN)
            ));
        }
    }

    parts.join("; ")
}

/// Truncate `value` to at most `max` characters, appending an
/// ellipsis when characters were dropped. Operates on `char` units
/// so it never splits a multi-byte UTF-8 sequence mid-codepoint.
fn truncate(value: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    if value.chars().count() <= max {
        return value.to_string();
    }
    let head: String = value.chars().take(max.saturating_sub(1)).collect();
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::{synthesize_failure_reason, FailureContext, MAX_ERROR_EXCERPT_LEN};

    fn empty_ctx() -> FailureContext {
        FailureContext::default()
    }

    #[test]
    fn all_none_yields_stable_unknown_string() {
        assert_eq!(
            synthesize_failure_reason(&empty_ctx()),
            "task failed: unknown"
        );
    }

    #[test]
    fn never_returns_empty_string_even_when_inputs_blank() {
        let ctx = FailureContext {
            real_reason: Some(String::new()),
            terminal_state: Some("   ".to_string()),
            last_tool_name: Some(String::new()),
            last_error_excerpt: Some("\n\n".to_string()),
        };
        let synthesized = synthesize_failure_reason(&ctx);
        assert!(
            !synthesized.is_empty(),
            "synthesizer must never return an empty string; got {synthesized:?}",
        );
        assert!(synthesized.starts_with("task failed: unknown"));
    }

    #[test]
    fn real_reason_takes_precedence_over_other_fields() {
        let ctx = FailureContext {
            real_reason: Some("  upstream returned 503 Service Unavailable  ".to_string()),
            terminal_state: Some("crashed".to_string()),
            last_tool_name: Some("edit_file".to_string()),
            last_error_excerpt: Some("Connection reset".to_string()),
        };
        assert_eq!(
            synthesize_failure_reason(&ctx),
            "upstream returned 503 Service Unavailable",
        );
    }

    #[test]
    fn empty_real_reason_falls_through_to_synthesis() {
        let ctx = FailureContext {
            real_reason: Some("   ".to_string()),
            terminal_state: Some("stalled".to_string()),
            ..empty_ctx()
        };
        assert_eq!(synthesize_failure_reason(&ctx), "task failed: stalled");
    }

    #[test]
    fn terminal_state_appears_in_lead_clause() {
        let ctx = FailureContext {
            terminal_state: Some("crashed".to_string()),
            ..empty_ctx()
        };
        assert!(synthesize_failure_reason(&ctx).contains("task failed: crashed"));
    }

    #[test]
    fn includes_last_tool_clause_when_present() {
        let ctx = FailureContext {
            terminal_state: Some("crashed".to_string()),
            last_tool_name: Some("run_command".to_string()),
            ..empty_ctx()
        };
        assert_eq!(
            synthesize_failure_reason(&ctx),
            "task failed: crashed; last tool run_command",
        );
    }

    #[test]
    fn includes_error_excerpt_when_present() {
        let ctx = FailureContext {
            terminal_state: Some("crashed".to_string()),
            last_error_excerpt: Some("Connection reset by peer".to_string()),
            ..empty_ctx()
        };
        assert_eq!(
            synthesize_failure_reason(&ctx),
            "task failed: crashed; error: Connection reset by peer",
        );
    }

    #[test]
    fn truncates_long_error_excerpts() {
        let long_excerpt = "x".repeat(MAX_ERROR_EXCERPT_LEN + 50);
        let ctx = FailureContext {
            terminal_state: Some("crashed".to_string()),
            last_error_excerpt: Some(long_excerpt.clone()),
            ..empty_ctx()
        };
        let synthesized = synthesize_failure_reason(&ctx);
        let excerpt_part = synthesized
            .split("error: ")
            .nth(1)
            .expect("synthesized string carries the error excerpt clause");
        assert_eq!(
            excerpt_part.chars().count(),
            MAX_ERROR_EXCERPT_LEN,
            "truncated excerpt must use exactly MAX_ERROR_EXCERPT_LEN chars",
        );
        assert!(
            excerpt_part.ends_with('…'),
            "truncated excerpt must end with the ellipsis marker; got {excerpt_part:?}",
        );
    }

    #[test]
    fn combines_all_clauses_in_documented_order() {
        let ctx = FailureContext {
            real_reason: None,
            terminal_state: Some("stalled".to_string()),
            last_tool_name: Some("read_file".to_string()),
            last_error_excerpt: Some("ENOENT".to_string()),
        };
        assert_eq!(
            synthesize_failure_reason(&ctx),
            "task failed: stalled; last tool read_file; error: ENOENT",
        );
    }

    #[test]
    fn handles_multibyte_excerpt_without_panicking() {
        // Truncation operates on char units, not bytes, so a long
        // multi-byte string must not split mid-codepoint.
        let long_multibyte = "é".repeat(MAX_ERROR_EXCERPT_LEN + 50);
        let ctx = FailureContext {
            terminal_state: Some("stalled".to_string()),
            last_error_excerpt: Some(long_multibyte),
            ..empty_ctx()
        };
        let synthesized = synthesize_failure_reason(&ctx);
        assert!(synthesized.contains("error: "));
        assert!(synthesized.ends_with('…'));
    }
}
