use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessFailureKind {
    Truncation,
    RateLimited,
    PushTimeout,
    CompletionContract,
    /// Harness aborted the agent after it stayed in research mode
    /// and never produced any file operation. Emitted verbatim by
    /// `aura-harness::validate_execution`'s post-hoc gate (the
    /// `task completed without any file operations — completion
    /// not verified` verdict, plus the `implementation phase / no
    /// file operations completed / failed_paths=0` decomposition
    /// hint). Retryable: the server-side dev loop schedules a
    /// fresh-context retry.
    ResearchLoopAbort,
    /// Terminal agent-side anti-waste signal: the harness has
    /// decided to stop on its own consecutive-error guard
    /// ("appears stuck", "stopping to prevent waste", ...).
    /// Restarting just tight-loops on the WS reconnect path, so
    /// the dev loop must not retry.
    AgentStuck,
    /// Provider rejected work because the account has no remaining
    /// credits (HTTP 402, "insufficient credits", "payment_required").
    /// Terminal — retrying or moving to the next task only burns
    /// build/setup time.
    InsufficientCredits,
    /// Transient provider internal error (5xx, stream aborted,
    /// connection reset). Retryable.
    ProviderInternal,
    Other,
}

impl HarnessFailureKind {
    /// True when the dev-loop should attempt another fresh run for
    /// a task that ended with this failure kind.
    ///
    /// Exhaustive `match` so adding a new variant forces an
    /// explicit retry-policy decision at the compiler.
    #[must_use]
    pub const fn is_retryable(self) -> bool {
        match self {
            HarnessFailureKind::RateLimited
            | HarnessFailureKind::PushTimeout
            | HarnessFailureKind::ResearchLoopAbort
            | HarnessFailureKind::ProviderInternal => true,
            HarnessFailureKind::Truncation
            | HarnessFailureKind::CompletionContract
            | HarnessFailureKind::AgentStuck
            | HarnessFailureKind::InsufficientCredits
            | HarnessFailureKind::Other => false,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HarnessSignal {
    TaskCompleted {
        task_id: Option<String>,
    },
    TaskFailed {
        task_id: Option<String>,
        reason: Option<String>,
        failure: HarnessFailureKind,
    },
    GitCommitted {
        task_id: Option<String>,
        commit_sha: Option<String>,
    },
    GitPushed {
        task_id: Option<String>,
        commit_sha: Option<String>,
    },
    GitPushFailed {
        task_id: Option<String>,
        commit_sha: Option<String>,
        reason: Option<String>,
    },
    ToolResult {
        task_id: Option<String>,
        name: Option<String>,
        is_error: bool,
        reason: Option<String>,
    },
}

impl HarnessSignal {
    pub fn from_event(event_type: &str, content: &serde_json::Value) -> Option<Self> {
        if let Some(signal) = Self::from_wrapped_event(event_type, content) {
            return Some(signal);
        }

        match event_type {
            "task_completed" => Some(Self::TaskCompleted {
                task_id: task_id(content),
            }),
            "task_failed" => {
                let reason = reason(content);
                Some(Self::TaskFailed {
                    task_id: task_id(content),
                    failure: classify_failure(reason.as_deref()),
                    reason,
                })
            }
            "git_committed" | "commit_created" => Some(Self::GitCommitted {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
            }),
            "git_pushed" | "push_succeeded" | "pushed" => Some(Self::GitPushed {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
            }),
            "git_push_failed" | "push_failed" => Some(Self::GitPushFailed {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
                reason: reason(content),
            }),
            "tool_call_completed" | "tool_result" => Some(Self::ToolResult {
                task_id: task_id(content),
                name: string_field(content, &["name", "tool_name"]),
                is_error: content
                    .get("is_error")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
                reason: reason(content),
            }),
            _ => None,
        }
    }

    fn from_wrapped_event(event_type: &str, content: &serde_json::Value) -> Option<Self> {
        match event_type {
            "task_sync_checkpoint" => content.get("checkpoint").and_then(|checkpoint| {
                Self::from_event_value_with_task_id(checkpoint, task_id(content))
            }),
            "task_checkpoint_state" => content
                .get("sync_state")
                .and_then(|state| state.get("status"))
                .and_then(|status| status.as_str())
                .and_then(|status| Self::from_event(status, content)),
            _ => None,
        }
    }

    pub fn from_event_value(value: &serde_json::Value) -> Option<Self> {
        Self::from_event_value_with_task_id(value, None)
    }

    pub fn task_id(&self) -> Option<&str> {
        match self {
            Self::TaskCompleted { task_id }
            | Self::TaskFailed { task_id, .. }
            | Self::GitCommitted { task_id, .. }
            | Self::GitPushed { task_id, .. }
            | Self::GitPushFailed { task_id, .. }
            | Self::ToolResult { task_id, .. } => task_id.as_deref(),
        }
    }

    pub fn failure_kind(&self) -> Option<HarnessFailureKind> {
        match self {
            Self::TaskFailed { failure, .. } => Some(*failure),
            Self::GitPushFailed { reason, .. } => Some(
                reason
                    .as_deref()
                    .map(|reason| {
                        if is_push_timeout(reason) {
                            HarnessFailureKind::PushTimeout
                        } else {
                            HarnessFailureKind::Other
                        }
                    })
                    .unwrap_or(HarnessFailureKind::Other),
            ),
            Self::ToolResult {
                is_error: true,
                name,
                reason,
                ..
            } => Some(classify_tool_result_failure(
                name.as_deref(),
                reason.as_deref(),
            )),
            _ => None,
        }
    }

    fn from_event_value_with_task_id(
        value: &serde_json::Value,
        fallback_task_id: Option<String>,
    ) -> Option<Self> {
        let event_type = string_field(value, &["type", "event_type", "kind", "status"])?;
        let mut content = value.clone();
        if task_id(&content).is_none() {
            if let (Some(object), Some(task_id)) = (content.as_object_mut(), fallback_task_id) {
                object.insert("task_id".into(), serde_json::Value::String(task_id));
            }
        }
        Self::from_event(&event_type, &content)
    }
}

pub fn classify_failure(reason: Option<&str>) -> HarnessFailureKind {
    let Some(reason) = reason else {
        return HarnessFailureKind::Other;
    };
    let reason = reason.to_ascii_lowercase();
    // Terminal anti-waste signals win first: a harness that decided to
    // stop on its own must not be restarted, even if the same payload
    // also mentions a research-loop abort.
    if is_agent_stuck(&reason) {
        HarnessFailureKind::AgentStuck
    } else if is_insufficient_credits(&reason) {
        HarnessFailureKind::InsufficientCredits
    } else if is_completion_contract_failure(&reason) {
        HarnessFailureKind::CompletionContract
    } else if is_research_loop_abort(&reason) {
        HarnessFailureKind::ResearchLoopAbort
    } else if reason.contains("truncat")
        || reason.contains("max_tokens")
        || reason.contains("maximum tokens")
        || reason.contains("needsdecomposition")
        || reason.contains("needs decomposition")
    {
        HarnessFailureKind::Truncation
    } else if is_rate_limited(&reason) {
        HarnessFailureKind::RateLimited
    } else if is_provider_internal(&reason) {
        HarnessFailureKind::ProviderInternal
    } else if is_push_timeout(&reason) {
        HarnessFailureKind::PushTimeout
    } else {
        HarnessFailureKind::Other
    }
}

/// Substring matcher for [`HarnessFailureKind::RateLimited`].
///
/// Matches provider rate-limit / overload responses (HTTP 429 / 529,
/// "overloaded", "rate_limited"). Caller must lowercase the input.
fn is_rate_limited(reason: &str) -> bool {
    reason.contains("rate limit")
        || reason.contains("rate_limited")
        || reason.contains("429")
        || reason.contains("529")
        || reason.contains("overloaded")
}

/// Substring matcher for [`HarnessFailureKind::InsufficientCredits`].
///
/// Caller must lowercase the input.
fn is_insufficient_credits(reason: &str) -> bool {
    reason.contains("insufficient credits")
        || reason.contains("insufficient_credits")
        || reason.contains("payment_required")
        || reason.contains("402 payment required")
        || (reason.contains("402") && reason.contains("payment required"))
}

/// Substring matcher for [`HarnessFailureKind::ProviderInternal`].
///
/// 5xx responses, "stream terminated", and "connection reset by peer"
/// are all classified as transient provider internal errors. Caller
/// must lowercase the input.
fn is_provider_internal(reason: &str) -> bool {
    reason.contains("internal server error")
        || reason.contains(" 500")
        || reason.contains(" 502")
        || reason.contains(" 503")
        || reason.contains(" 504")
        || reason.contains("stream terminated")
        || reason.contains("connection reset by peer")
}

/// Substring matcher for [`HarnessFailureKind::ResearchLoopAbort`].
///
/// Caller must lowercase the input. The third needle requires all of
/// "implementation phase", "no file operations completed", and
/// "failed_paths=0" so an unrelated "implementation phase" mention
/// in a longer reason string doesn't false-positive.
fn is_research_loop_abort(reason: &str) -> bool {
    reason.contains("task completed without any file operations")
        || reason.contains("completion not verified")
        || (reason.contains("implementation phase")
            && reason.contains("no file operations completed")
            && reason.contains("failed_paths=0"))
}

/// Substring matcher for [`HarnessFailureKind::AgentStuck`].
///
/// Caller must lowercase the input.
fn is_agent_stuck(reason: &str) -> bool {
    reason.contains("appears stuck")
        || reason.contains("agent is stuck")
        || reason.contains("consecutive error")
        || reason.contains("consecutive failure")
        || reason.contains("all tool calls have returned errors")
        || reason.contains("prevent waste")
        || reason.contains("conserve budget")
}

fn classify_tool_result_failure(name: Option<&str>, reason: Option<&str>) -> HarnessFailureKind {
    if name == Some("git_commit_push")
        && reason
            .map(|reason| {
                let reason = reason.to_ascii_lowercase();
                reason.contains("timeout") || reason.contains("timed out")
            })
            .unwrap_or(false)
    {
        return HarnessFailureKind::PushTimeout;
    }
    classify_failure(reason)
}

// The workspace-health blocking verdict reason emitted by
// `aura_os_automation::classify_delta`. Duplicated as a `&str`
// literal (instead of `use`-ing the constant from `aura_os_automation`)
// because `aura-os-harness` lives BELOW `aura-os-automation` in the
// dep graph. The exact string is pinned by the test suite in
// `aura_os_automation::health::delta::tests` so this duplication will
// fail loudly if the canonical reason ever changes.
const WORKSPACE_HEALTH_BLOCKING_REASONS: &[&str] = &["workspace_health_regressed"];

fn is_completion_contract_failure(reason: &str) -> bool {
    let mentions_task_done =
        reason.contains("task_done") || reason.contains("completing this task");
    let mentions_missing_edits = reason.contains("not made any file changes")
        || reason.contains("no file changes")
        || reason.contains("no files changed")
        || reason.contains("no file edited")
        || reason.contains("no file edits");
    let mentions_no_change_escape_hatch = reason.contains("no_changes_needed");
    let mentions_workspace_health_verdict = WORKSPACE_HEALTH_BLOCKING_REASONS
        .iter()
        .any(|needle| reason.contains(needle));

    mentions_task_done && (mentions_missing_edits || mentions_no_change_escape_hatch)
        || mentions_workspace_health_verdict
}

fn is_push_timeout(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("git")
        && reason.contains("push")
        && (reason.contains("timeout") || reason.contains("timed out"))
}

fn task_id(value: &serde_json::Value) -> Option<String> {
    string_field(value, &["task_id", "taskId"])
}

fn commit_sha(value: &serde_json::Value) -> Option<String> {
    string_field(value, &["commit_sha", "commitSha", "sha"]).or_else(|| {
        value
            .get("commits")
            .and_then(|commits| commits.as_array())
            .and_then(|commits| commits.last())
            .and_then(|commit| commit.get("sha"))
            .and_then(|sha| sha.as_str())
            .map(str::to_owned)
    })
}

fn reason(value: &serde_json::Value) -> Option<String> {
    string_field(
        value,
        &[
            "reason",
            "error",
            "message",
            "result",
            "result_preview",
            "failure_class",
        ],
    )
}

fn string_field(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_task_failed_with_classification() {
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": "harness response truncated; needs decomposition",
            }),
        )
        .expect("signal");

        assert_eq!(signal.task_id(), Some("task-1"));
        assert_eq!(signal.failure_kind(), Some(HarnessFailureKind::Truncation));
    }

    #[test]
    fn classifies_task_done_without_file_edits_as_completion_contract() {
        let reason = "ERROR: You are completing this task but have not made any file changes \
                      (write_file, edit_file, or delete_file). Implementation tasks must produce \
                      file changes. If this task genuinely requires no file changes, call \
                      task_done again with \"no_changes_needed\": true and explain why in the \
                      notes field.";
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": reason,
            }),
        )
        .expect("signal");

        assert_eq!(
            signal.failure_kind(),
            Some(HarnessFailureKind::CompletionContract)
        );
    }

    #[test]
    fn classifies_research_loop_abort_as_research_loop_abort() {
        // Verbatim verdict emitted by aura-harness's post-hoc
        // `validate_execution` gate when the agent stayed in
        // research mode and never produced any file operation.
        // The em dash is U+2014; the classifier must accept it.
        let reason = "agent execution error: task completed without any file operations — \
                      completion not verified";
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": reason,
            }),
        )
        .expect("signal");

        assert_eq!(
            signal.failure_kind(),
            Some(HarnessFailureKind::ResearchLoopAbort),
            "research-loop abort must classify as its own typed variant \
             so the server-side retry path can route it to a fresh-context retry",
        );
    }

    #[test]
    fn classifies_implementation_phase_no_write_abort_as_research_loop_abort() {
        for last_pending in ["search_code", "submit_plan"] {
            let reason = format!(
                "task reached implementation phase but no file operations completed — \
                 needs decomposition (failed_paths=0, last_pending=Some(\"{last_pending}\"))"
            );
            let signal = HarnessSignal::from_event(
                "task_failed",
                &serde_json::json!({
                    "task_id": "task-1",
                    "reason": reason,
                }),
            )
            .expect("signal");

            assert_eq!(
                signal.failure_kind(),
                Some(HarnessFailureKind::ResearchLoopAbort),
                "{last_pending} no-write abort must classify as ResearchLoopAbort",
            );
        }
    }

    #[test]
    fn research_loop_abort_matches_lowercased_input() {
        // The classifier lowercases the reason before comparing, so an
        // upper-case verdict from a different code path still resolves.
        assert_eq!(
            classify_failure(Some("TASK COMPLETED WITHOUT ANY FILE OPERATIONS")),
            HarnessFailureKind::ResearchLoopAbort,
        );
    }

    #[test]
    fn agent_stuck_precedence_beats_research_loop_abort() {
        // A reason that contains BOTH needles must classify as terminal:
        // the agent-stuck guard runs first, so a harness that decided
        // to stop on its own anti-waste verdict must not be classified
        // as a retryable research-loop abort just because the same
        // payload also mentions the research-loop phrasing.
        let reason = "agent is stuck after task completed without any file operations";
        assert_eq!(
            classify_failure(Some(reason)),
            HarnessFailureKind::AgentStuck,
            "agent-stuck precedence must win — restarting a stuck harness \
             just thrashes the WS reconnect path",
        );
    }

    #[test]
    fn classifies_agent_stuck_anti_waste_signals() {
        let stuck = [
            "agent appears stuck — no progress",
            "agent is stuck after consecutive errors",
            "10 consecutive errors observed",
            "stopping to prevent waste",
            "halting to conserve budget",
            "all tool calls have returned errors",
        ];
        for reason in stuck {
            assert_eq!(
                classify_failure(Some(reason)),
                HarnessFailureKind::AgentStuck,
                "expected agent_stuck: {reason}",
            );
        }
    }

    #[test]
    fn classifies_insufficient_credits_provider_phrasings() {
        let positives = [
            "Insufficient credits",
            "insufficient_credits",
            "payment_required",
            "402 payment required",
            "Anthropic 402 Payment Required - balance=0",
        ];
        for reason in positives {
            assert_eq!(
                classify_failure(Some(reason)),
                HarnessFailureKind::InsufficientCredits,
                "expected insufficient_credits: {reason}",
            );
        }
    }

    #[test]
    fn classifies_provider_internal_5xx_and_stream_aborts() {
        let positives = [
            "Internal server error",
            "upstream returned 500",
            "got 502 bad gateway",
            "upstream 503 service unavailable",
            "upstream 504 gateway timeout",
            "stream terminated unexpectedly",
            "connection reset by peer",
        ];
        for reason in positives {
            assert_eq!(
                classify_failure(Some(reason)),
                HarnessFailureKind::ProviderInternal,
                "expected provider_internal: {reason}",
            );
        }
    }

    #[test]
    fn classifies_rate_limited_provider_phrasings() {
        let positives = [
            "rate limit exceeded",
            "rate_limited",
            "overloaded_error",
            "HTTP 429 Too Many Requests",
            "got 529 from upstream",
        ];
        for reason in positives {
            assert_eq!(
                classify_failure(Some(reason)),
                HarnessFailureKind::RateLimited,
                "expected rate_limited: {reason}",
            );
        }
    }

    #[test]
    fn is_retryable_pinned_by_kind() {
        // Pin the typed retry-policy table so adding a new variant
        // forces an explicit decision via the exhaustive `match`.
        assert!(HarnessFailureKind::RateLimited.is_retryable());
        assert!(HarnessFailureKind::PushTimeout.is_retryable());
        assert!(HarnessFailureKind::ResearchLoopAbort.is_retryable());
        assert!(HarnessFailureKind::ProviderInternal.is_retryable());
        assert!(!HarnessFailureKind::Truncation.is_retryable());
        assert!(!HarnessFailureKind::CompletionContract.is_retryable());
        assert!(!HarnessFailureKind::AgentStuck.is_retryable());
        assert!(!HarnessFailureKind::InsufficientCredits.is_retryable());
        assert!(!HarnessFailureKind::Other.is_retryable());
    }

    #[test]
    fn completion_contract_does_not_swallow_plain_truncation() {
        assert_eq!(
            classify_failure(Some(
                "response truncated because no file context was available"
            )),
            HarnessFailureKind::Truncation
        );
    }

    #[test]
    fn parses_legacy_git_push_failed_step() {
        let signal = HarnessSignal::from_event_value(&serde_json::json!({
            "type": "git_push_failed",
            "commit_sha": "abc123",
            "reason": "git push timeout",
        }))
        .expect("signal");

        assert_eq!(signal.failure_kind(), Some(HarnessFailureKind::PushTimeout));
        assert!(matches!(
            signal,
            HarnessSignal::GitPushFailed {
                commit_sha: Some(ref sha),
                ..
            } if sha == "abc123"
        ));
    }

    #[test]
    fn classifies_git_commit_push_tool_timeout_as_push_timeout() {
        let signal = HarnessSignal::from_event(
            "tool_call_completed",
            &serde_json::json!({
                "task_id": "task-1",
                "name": "git_commit_push",
                "is_error": true,
                "result": "Tool timed out after 120000ms",
            }),
        )
        .expect("signal");

        assert_eq!(signal.failure_kind(), Some(HarnessFailureKind::PushTimeout));
    }

    // -----------------------------------------------------------------
    // The workspace-health blocking verdict must classify as
    // `CompletionContract` so the server-side restart path routes it
    // through the same fresh-context retry loop as the existing
    // `task_done` / research-loop failures.
    // -----------------------------------------------------------------

    #[test]
    fn classifies_workspace_health_regressed_as_completion_contract() {
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": "workspace_health_regressed: 2 new error(s) in zero-storage (E0277)",
            }),
        )
        .expect("signal");

        assert_eq!(
            signal.failure_kind(),
            Some(HarnessFailureKind::CompletionContract),
            "workspace_health_regressed must classify as a \
             CompletionContract failure so the dev-loop restart \
             path treats it as restartable",
        );
    }

    #[test]
    fn parses_checkpoint_wrapper_with_task_id() {
        let signal = HarnessSignal::from_event(
            "task_sync_checkpoint",
            &serde_json::json!({
                "task_id": "task-1",
                "checkpoint": {
                    "kind": "git_pushed",
                    "commits": [{ "sha": "def456" }],
                },
            }),
        )
        .expect("signal");

        assert_eq!(signal.task_id(), Some("task-1"));
        assert!(matches!(
            signal,
            HarnessSignal::GitPushed {
                commit_sha: Some(ref sha),
                ..
            } if sha == "def456"
        ));
    }
}
