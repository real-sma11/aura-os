//! Side-effects triggered by individual harness events: enriches the payload, broadcasts to live subscribers + the topic-scoped event hub, and dispatches into focused submodules (failure persistence + test-evidence override, retry plumbing, git checkpoints, task-output cache, cross-turn file-change merging).

mod common;
mod failure;
mod files;
mod git;
mod retry;
mod task_output;

use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_loops::LoopHandle;

use super::super::health::{classify_delta, format_health_summary};
use super::super::session::record_task_worked;
use super::super::signals::{
    extract_task_failure_context, health_gate_enabled, snapshot_workspace_health,
};
use super::super::types::LoopRetryState;
use super::emit_log_line;
use crate::handlers::projects_helpers::resolve_agent_instance_workspace_path;
use crate::log_throttle::{self, LogThrottleKey};
use crate::state::AppState;

use common::{enrich_event, set_current_task};

pub(crate) use failure::extract_task_failure_reason;
pub(crate) use task_output::seed_task_output;

/// Per-task ceiling on auto-retry hops the dev-loop will issue from
/// the `task_failed` arm before leaving the task in `Failed` for
/// good. Mirrored against the persisted `tasks.attempts` column so
/// the budget survives server restarts.
pub(crate) const MAX_TASK_ATTEMPTS: u32 = 3;

/// Bundle of context the side-effects pipeline needs for every
/// event. Grouped into a struct so [`record_event_side_effects`] and
/// [`apply_event_side_effect`] stay under the project's
/// argument-count budget (`rules-rust.md`) without needing
/// `#[allow(clippy::too_many_arguments)]`.
///
/// The `loop_handle` borrow is the bug-fix-bearing addition: the
/// forwarder owns an `Arc<LoopHandle>` for the run currently being
/// driven, and we need it here so `task_started` / `task_completed`
/// / `task_failed` can push the typed `TaskId` onto
/// `LoopActivity.current_task_id`. Without that update the per-task
/// UI spinner in `TaskList` cannot bind to a task row and the run
/// looks idle even while the harness is working.
pub(super) struct SideEffectCtx<'a> {
    pub state: &'a AppState,
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub loop_handle: &'a LoopHandle,
    pub jwt: Option<&'a str>,
    pub session_id: Option<SessionId>,
    /// Per-loop retry state, held as a borrow on the Arc the
    /// forwarder owns so the side-effects pipeline can both read
    /// the trackers directly (auto-deref through `Arc`) and clone
    /// the Arc into a `tokio::spawn`ed task without re-wrapping —
    /// used by the `task_started` workspace-health snapshot to stash
    /// the captured baseline back onto
    /// [`LoopRetryState::health_baseline`].
    pub retry_state: &'a Arc<LoopRetryState>,
}

pub(super) async fn record_event_side_effects(
    ctx: &SideEffectCtx<'_>,
    fallback_task_id: Option<String>,
    event: serde_json::Value,
    event_type: &str,
) {
    let state = ctx.state;
    let project_id = ctx.project_id;
    let agent_instance_id = ctx.agent_instance_id;
    let session_id = ctx.session_id;
    let task_id = event
        .get("task_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(fallback_task_id);
    let mut enriched = enrich_event(
        event.clone(),
        project_id,
        agent_instance_id,
        task_id.as_deref(),
        session_id,
    );
    if event_type == "task_failed" {
        let reason = extract_task_failure_reason(&enriched);
        let failure_ctx = extract_task_failure_context(&enriched, reason.as_deref());
        if failure_ctx.has_any() {
            if let Some(object) = enriched.as_object_mut() {
                failure_ctx.merge_into(object);
            }
        }
    }

    let mut effective_event_type: &str = event_type;
    let mut broadcast_payload = enriched;

    // Workspace-health diff gate (opt-in via `AURA_HEALTH_GATE`).
    // Reads the baseline stashed at `task_started`, snapshots the
    // current workspace, and demotes `task_completed` to `task_failed`
    // when the workspace is in a worse state than when the task
    // started (more errors, or tests regressed from passing to
    // failing). Blocking verdicts produce a `task_failed` payload
    // whose `reason` embeds `workspace_health_regressed` verbatim so
    // the harness classifier routes it through the existing
    // CompletionContract → fresh-context retry path.
    if effective_event_type == "task_completed" && health_gate_enabled() {
        if let Some(task_uuid) = task_id.as_deref().and_then(|s| TaskId::from_str(s).ok()) {
            if let Some(verdict) = maybe_run_health_gate(
                state,
                project_id,
                agent_instance_id,
                ctx.retry_state,
                task_uuid,
            )
            .await
            {
                broadcast_payload = synthesize_health_gate_failure(&broadcast_payload, &verdict);
                effective_event_type = "task_failed";
                tracing::warn!(
                    %project_id,
                    %agent_instance_id,
                    task_id = task_uuid.to_string(),
                    reason = verdict.reason,
                    elapsed_ms = verdict.elapsed_ms,
                    "workspace-health gate demoted task_completed to task_failed"
                );
            }
        }
    }

    let _ = state.event_broadcast.send(broadcast_payload.clone());
    state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            session_id,
            loop_id: None,
            payload: broadcast_payload,
        }));

    surface_log_lines_for_event(
        state,
        project_id,
        agent_instance_id,
        session_id,
        effective_event_type,
        task_id.as_deref(),
        &event,
    );

    apply_event_side_effect(ctx, effective_event_type, task_id.as_deref(), &event).await;
}

async fn apply_event_side_effect(
    ctx: &SideEffectCtx<'_>,
    event_type: &str,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    let state = ctx.state;
    let project_id = ctx.project_id;
    let agent_instance_id = ctx.agent_instance_id;
    let loop_handle = ctx.loop_handle;
    let jwt = ctx.jwt;
    let session_id = ctx.session_id;
    let retry_state = ctx.retry_state;
    match event_type {
        "task_started" => {
            if let Some(task_id) = task_id {
                seed_task_output(state, project_id, agent_instance_id, session_id, task_id).await;
                set_current_task(loop_handle, Some(task_id.to_string())).await;
                // Bump `tasks_worked_count` on the storage session and
                // stamp `tasks.session_id` on the task row in one shot.
                // This arm is the single writer of `tasks.session_id`.
                if let Some(session_id) = session_id {
                    record_task_worked(
                        state,
                        jwt,
                        project_id,
                        agent_instance_id,
                        session_id,
                        task_id,
                    )
                    .await;
                }
                // Workspace-health baseline. Captures the build state
                // at task start so the completion gate can compare
                // against task_done. Runs in the background so it
                // never adds claim latency; if it doesn't finish
                // before task_done, the gate falls back to "unknown
                // baseline".
                if let Ok(task_uuid) = TaskId::from_str(task_id) {
                    let retry_state_for_snapshot = retry_state.clone();
                    if let Some(workspace_path) = resolve_agent_instance_workspace_path(
                        state,
                        &project_id,
                        Some(agent_instance_id),
                    )
                    .await
                    {
                        tokio::spawn(async move {
                            let health = snapshot_workspace_health(workspace_path).await;
                            retry_state_for_snapshot
                                .health_baseline
                                .record(task_uuid, health);
                        });
                    }
                }
            }
        }
        "task_completed" => {
            set_current_task(loop_handle, None).await;
            // Drop the workspace-health baseline so a rerun of the
            // same task starts fresh rather than diffing against the
            // prior snapshot. Per-task retry counters live on the
            // persisted `tasks.attempts` column and don't need an
            // in-memory companion here.
            if let Some(task_uuid) = task_id.and_then(|s| TaskId::from_str(s).ok()) {
                retry_state.health_baseline.clear(task_uuid);
            }
            // Drain the in-memory `task_output_cache` (tokens, files-
            // changed, live output, build/test/git steps) into the
            // persisted aura-storage task record + session events.
            // Without this, tokens accumulated in `update_usage_cache`
            // are silently discarded when the cache is evicted,
            // leaving the dashboard "Tokens" stat at 0.
            if let (Some(task_id), Some(jwt)) = (task_id, jwt) {
                task_output::persist_cached_task_output(state, project_id, jwt, task_id).await;
            }
        }
        "task_failed" => {
            set_current_task(loop_handle, None).await;
            // Drop the workspace-health baseline so the next attempt
            // (either a fresh task_started after a retry hop below
            // or a future manual rerun) observes a fresh baseline
            // rather than diffing against the stale one.
            if let Some(task_uuid) = task_id.and_then(|s| TaskId::from_str(s).ok()) {
                retry_state.health_baseline.clear(task_uuid);
            }
            // Persist the fail reason onto `tasks.execution_notes` so
            // it survives a page reload. The live WebSocket path
            // already carries the reason to `useTaskStatus`, but that
            // state resets to `null` on mount; without this write,
            // "Copy All Output" on a reloaded failed task has no
            // reason to render (the hook has nothing to seed from).
            //
            // When the harness emits `task_failed` without a usable
            // reason field, the persistence helper falls back to
            // `synthesize_failure_reason` so the row never shows the
            // silent "Task failed without producing output" state on
            // reload.
            if let (Some(task_id), Some(jwt)) = (task_id, jwt) {
                failure::persist_task_failure_reason(state, jwt, task_id, event).await;
                // Same accumulator drain as task_completed: failed tasks
                // also have token usage that should appear in stats.
                task_output::persist_cached_task_output(state, project_id, jwt, task_id).await;
                // Task-level auto-retry: only push the task back to
                // `Ready` when the failure reason is retryable
                // (`HarnessFailureKind::is_retryable`) and the
                // persisted `tasks.attempts` is strictly below
                // `MAX_TASK_ATTEMPTS`. Otherwise the task stays
                // `Failed` and the existing surfaces handle it.
                retry::maybe_apply_task_level_retry(
                    state,
                    jwt,
                    task_id,
                    event,
                    project_id,
                    agent_instance_id,
                    session_id,
                )
                .await;
            }
        }
        "tool_call_completed" => {
            if let Some(task_id) = task_id {
                task_output::record_test_pass_evidence(state, project_id, task_id, event).await;
                git::record_git_commit_push_timeout(state, project_id, task_id, event).await;
            }
        }
        "git_committed" | "commit_created" | "git_commit_failed" | "git_pushed"
        | "push_succeeded" | "git_push_failed" | "push_failed" => {
            if let Some(task_id) = task_id {
                git::record_git_checkpoint(state, project_id, task_id, event_type, event).await;
            }
        }
        "text_delta" => {
            if let Some((task_id, text)) = task_id.zip(common::event_text(event)) {
                task_output::append_task_output(state, project_id, task_id, text).await;
            }
        }
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            if let Some(task_id) = task_id.as_deref() {
                task_output::update_usage_cache(state, project_id, task_id, event).await;
            }
            if event_type == "assistant_message_end" {
                if let Some(task_id) = task_id.as_deref() {
                    files::record_files_changed(state, project_id, task_id, event).await;
                }
            }
        }
        _ => {}
    }
}

/// Surface free-text `log_line` rows for engine events that the
/// SidekickLog panel's subscription set (`ALL_ENGINE_EVENT_TYPES` in
/// `interface/src/hooks/use-log-stream.ts`) does not otherwise
/// cover. Without these, an active run looks idle between coarse
/// engine milestones (task_started -> file_ops_applied ->
/// build_passed) because the LLM can spend tens of seconds streaming
/// text and dispatching tools while the panel renders nothing.
///
/// Each emission goes through [`emit_log_line`] so it lands on the
/// same `event_broadcast` and topic-scoped hub as the typed events;
/// the persistence allowlist already includes `log_line` so history
/// reloads pick these up too.
///
/// High-frequency channels (`text_delta`) are rate-limited via the
/// process-wide [`crate::log_throttle`] singleton so a single fast
/// turn cannot drown the panel.
fn surface_log_lines_for_event(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    event_type: &str,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    let Some(message) = log_line_for_event(event_type, event) else {
        return;
    };
    if let Some(channel) = throttle_channel_for(event_type) {
        let key = LogThrottleKey::new(
            project_id.to_string(),
            agent_instance_id.to_string(),
            channel,
        );
        if !log_throttle::should_emit(key) {
            return;
        }
    }
    let extra = task_id.map_or_else(
        || serde_json::json!({}),
        |task_id| serde_json::json!({ "task_id": task_id }),
    );
    emit_log_line(
        state,
        project_id,
        agent_instance_id,
        session_id,
        message,
        extra,
    );
}

/// Pure mapping from an engine event into the optional `log_line`
/// message text the panel should render. `None` means "no log_line
/// for this event type" --- most events fall through to the existing
/// engine-event row in the panel and don't need a parallel `LOG`
/// row. Split out from [`surface_log_lines_for_event`] so the
/// per-event rendering can be exercised in a unit test without
/// standing up an [`AppState`].
pub(super) fn log_line_for_event(event_type: &str, event: &serde_json::Value) -> Option<String> {
    match event_type {
        "tool_call_started" | "tool_use_start" => {
            Some(format!("Calling tool: {}", tool_name_for_log(event)))
        }
        "tool_call_completed" => {
            let name = tool_name_for_log(event);
            let suffix = if event
                .get("is_error")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                " (error)"
            } else {
                ""
            };
            Some(format!("Tool completed: {name}{suffix}"))
        }
        "text_delta" => Some("Streaming response...".to_string()),
        "assistant_message_end" => Some(match assistant_turn_tokens(event) {
            (Some(input), Some(output)) => {
                format!("Turn ended ({input} in / {output} out tokens)")
            }
            _ => "Turn ended".to_string(),
        }),
        _ => None,
    }
}

/// Return the throttle channel discriminator for an event type, or
/// `None` when the event should always emit. Channels are
/// `&'static str` so the throttle key remains allocation-free.
///
/// `text_delta` is the only high-frequency channel --- the harness
/// streams hundreds per turn --- so it is the only event throttled by
/// default. Tool-call lifecycle events fire once per call, so they
/// pass through every time.
fn throttle_channel_for(event_type: &str) -> Option<&'static str> {
    match event_type {
        "text_delta" => Some("text_delta"),
        _ => None,
    }
}

/// First populated string among the harness's tool-name aliases.
/// Defaults to `"tool"` so the row stays readable when the harness
/// omits the name field entirely.
fn tool_name_for_log(event: &serde_json::Value) -> &str {
    ["name", "tool_name", "tool"]
        .into_iter()
        .find_map(|key| event.get(key).and_then(|value| value.as_str()))
        .filter(|value| !value.is_empty())
        .unwrap_or("tool")
}

/// Verdict from the workspace-health gate when it decides to demote
/// a `task_completed` to `task_failed`. Carries everything
/// [`synthesize_health_gate_failure`] needs to stamp a fully-formed
/// failure payload (baseline/current summaries, elapsed wall-clock)
/// without re-reading any tracker state.
#[derive(Debug, Clone)]
struct HealthGateVerdict {
    /// Stable blocking reason string spliced verbatim into the demoted
    /// `task_failed` reason text so the harness classifier routes the
    /// failure through the existing CompletionContract → fresh-context
    /// retry path.
    reason: &'static str,
    /// Human-readable summary of the workspace baseline captured at
    /// `task_started`. Used as the "before" half of the failure
    /// message.
    baseline_summary: String,
    /// Human-readable summary of the post-`task_completed` workspace
    /// snapshot. The "after" half of the failure message.
    current_summary: String,
    /// Wall-clock spent running the gate end-to-end (snapshot +
    /// classify). Exposed both for the warn-level log line and as a
    /// telemetry field on the synthesized payload.
    elapsed_ms: u64,
}

/// Run the workspace-health diff gate for `task_uuid`, returning
/// `Some(HealthGateVerdict)` only when the current workspace is in a
/// worse state than the baseline (more errors, or tests regressed
/// from passing to failing). Every other path (no baseline, no
/// workspace path, non-blocking verdict) returns `None` so the
/// caller emits the harness's original `task_completed`.
async fn maybe_run_health_gate(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    retry_state: &Arc<LoopRetryState>,
    task_uuid: TaskId,
) -> Option<HealthGateVerdict> {
    let baseline_entry = retry_state.health_baseline.get(task_uuid)?;
    let workspace_path =
        resolve_agent_instance_workspace_path(state, &project_id, Some(agent_instance_id)).await?;
    let start = Instant::now();
    let current_health = snapshot_workspace_health(workspace_path.clone()).await;
    let delta = classify_delta(&baseline_entry.health, &current_health);
    if !delta.verdict.blocks_task_done() {
        return None;
    }
    let baseline_summary = format_health_summary(&baseline_entry.health);
    let current_summary = format_health_summary(&current_health);
    Some(HealthGateVerdict {
        reason: delta.reason,
        baseline_summary,
        current_summary,
        elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

/// Build a synthetic `task_failed` payload from the harness's
/// `task_completed` enriched event when the workspace-health gate
/// produced a blocking verdict.
///
/// The rendered `reason` / `message` text EMBEDS `verdict.reason` as
/// a literal substring so the cross-crate harness classifier picks
/// the failure up and routes it through the existing fresh-context
/// retry path. Original payload fields (task_id, session_id,
/// timestamps, …) are preserved verbatim; the health-gate-specific
/// telemetry lands on top-level `health_gate_*` fields so the
/// dashboard can surface them.
fn synthesize_health_gate_failure(
    original: &serde_json::Value,
    verdict: &HealthGateVerdict,
) -> serde_json::Value {
    let mut payload = original.clone();
    let reason = format!(
        "{verdict_reason}: {baseline_fragment}; current snapshot: {current_fragment}. \
         Fix the red as part of this task or hand back with a status update.",
        verdict_reason = verdict.reason,
        baseline_fragment = verdict.baseline_summary,
        current_fragment = verdict.current_summary,
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert("type".into(), serde_json::Value::from("task_failed"));
        object.insert("event_type".into(), serde_json::Value::from("task_failed"));
        object.insert("reason".into(), serde_json::Value::from(reason.clone()));
        object.insert("message".into(), serde_json::Value::from(reason));
        object.insert(
            "health_gate_reason".into(),
            serde_json::Value::from(verdict.reason),
        );
        object.insert(
            "health_gate_elapsed_ms".into(),
            serde_json::Value::from(verdict.elapsed_ms),
        );
        object.insert(
            "health_gate_baseline_summary".into(),
            serde_json::Value::from(verdict.baseline_summary.clone()),
        );
        object.insert(
            "health_gate_current_summary".into(),
            serde_json::Value::from(verdict.current_summary.clone()),
        );
    }
    payload
}

/// Extract `(input_tokens, output_tokens)` from an
/// `assistant_message_end` payload. Looks under both the top-level
/// fields the legacy harness emits and the nested `usage` object the
/// current harness uses.
fn assistant_turn_tokens(event: &serde_json::Value) -> (Option<u64>, Option<u64>) {
    let read = |path: &[&str]| -> Option<u64> {
        let mut node = event;
        for key in path {
            node = node.get(key)?;
        }
        node.as_u64()
    };
    let input = read(&["input_tokens"]).or_else(|| read(&["usage", "input_tokens"]));
    let output = read(&["output_tokens"]).or_else(|| read(&["usage", "output_tokens"]));
    (input, output)
}

#[cfg(test)]
mod health_gate_synthesizer_tests {
    use super::*;

    /// The synthesised payload must preserve every non-overlay field
    /// from the original and stamp `type` / `event_type` /
    /// `health_gate_*` on top.
    #[test]
    fn synthesize_health_gate_failure_overlays_failure_fields_on_original() {
        let original = serde_json::json!({
            "type": "task_completed",
            "event_type": "task_completed",
            "task_id": "task-789",
            "session_id": "ses-456",
            "timestamp": "2026-05-19T22:00:00Z",
            "extra": "preserve me"
        });
        let verdict = HealthGateVerdict {
            reason: super::super::super::health::REASON_REGRESSED,
            baseline_summary: "workspace red at task start: 1 errors across 1 files \
                 (e.g. crates/zero-storage [E0277])"
                .to_string(),
            current_summary: "workspace red at task start: 4 errors across 1 files \
                 (e.g. crates/zero-storage [E0277 \u{00d7}2, E0432, E0425])"
                .to_string(),
            elapsed_ms: 2_345,
        };
        let synthetic = synthesize_health_gate_failure(&original, &verdict);
        assert_eq!(synthetic["type"], "task_failed");
        assert_eq!(synthetic["event_type"], "task_failed");
        assert_eq!(synthetic["task_id"], "task-789");
        assert_eq!(synthetic["session_id"], "ses-456");
        assert_eq!(synthetic["extra"], "preserve me");
        assert_eq!(synthetic["timestamp"], "2026-05-19T22:00:00Z");
        assert_eq!(synthetic["health_gate_reason"], "workspace_health_regressed");
        assert_eq!(synthetic["health_gate_elapsed_ms"], 2_345);
        assert!(synthetic["health_gate_baseline_summary"]
            .as_str()
            .unwrap()
            .contains("crates/zero-storage"));
        assert!(synthetic["health_gate_current_summary"]
            .as_str()
            .unwrap()
            .contains("crates/zero-storage"));
        let reason = synthetic["reason"].as_str().expect("reason set");
        assert!(reason.contains("workspace_health_regressed"));
        assert!(reason.contains("crates/zero-storage"));
        assert_eq!(synthetic["message"], synthetic["reason"]);
    }

    /// The synthetic reason string must embed each blocking constant
    /// — that is the contract the harness classifier relies on
    /// (`contains_workspace_health_blocking_reason` is a substring
    /// match against the rendered message).
    #[test]
    fn synthesize_health_gate_failure_embeds_blocking_reason_so_classifier_matches() {
        for blocking_reason in super::super::super::health::WORKSPACE_HEALTH_BLOCKING_REASONS {
            let verdict = HealthGateVerdict {
                reason: blocking_reason,
                baseline_summary: "baseline".to_string(),
                current_summary: "current".to_string(),
                elapsed_ms: 100,
            };
            let synthetic =
                synthesize_health_gate_failure(&serde_json::json!({"task_id": "t"}), &verdict);
            let reason = synthetic["reason"].as_str().expect("reason set");
            assert!(
                super::super::super::health::contains_workspace_health_blocking_reason(reason),
                "rendered reason {reason:?} must match the cross-crate \
                 substring predicate for blocking_reason={blocking_reason}",
            );
        }
    }

    /// Pin the `AURA_HEALTH_GATE` env-var parser at the integration
    /// boundary where the side-effects pipeline consumes it. The
    /// in-module parsing test inside `signals::health_snapshot`
    /// covers the truthy / falsy table exhaustively; this test only
    /// has to assert that the re-export the side-effects pipeline
    /// imports reflects changes to the underlying env var so a
    /// future signal-module refactor that breaks the re-export
    /// blows up here.
    #[test]
    fn health_gate_enabled_respects_env_var_parsing() {
        let key = "AURA_HEALTH_GATE";
        let original = std::env::var(key).ok();
        // SAFETY: env mutation is constrained to this test scope and
        // restored at the end.
        std::env::set_var(key, "1");
        assert!(health_gate_enabled());
        std::env::set_var(key, "yes");
        assert!(health_gate_enabled());
        std::env::set_var(key, "ON");
        assert!(health_gate_enabled());
        std::env::set_var(key, "false");
        assert!(!health_gate_enabled());
        std::env::set_var(key, "");
        assert!(!health_gate_enabled());
        std::env::remove_var(key);
        assert!(!health_gate_enabled());
        if let Some(value) = original {
            std::env::set_var(key, value);
        }
    }
}

