//! Side-effects triggered by individual harness events: enriches the payload, broadcasts to live subscribers + the topic-scoped event hub, and dispatches into focused submodules (failure persistence + test-evidence override, retry plumbing, git checkpoints, task-output cache, cross-turn file-change merging).

mod common;
mod failure;
mod files;
mod git;
mod retry;
mod task_output;

use std::str::FromStr;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_loops::LoopHandle;

use super::super::session::record_task_worked;
use super::super::signals::{
    build_gate_enabled, extract_task_failure_context, render_demoted_failure_reason,
    run_build_preflight, BuildPreflight,
};
use super::super::types::LoopRetryState;
use super::emit_log_line;
use crate::handlers::projects_helpers::resolve_agent_instance_workspace_path;
use crate::log_throttle::{self, LogThrottleKey};
use crate::state::AppState;

use common::{enrich_event, set_current_task};

pub(crate) use failure::extract_task_failure_reason;
pub(crate) use task_output::seed_task_output;

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
    pub retry_state: &'a LoopRetryState,
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
    let jwt = ctx.jwt;
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

    // Tests-as-truth override: if this is a CompletionContract
    // `task_failed` and we accumulated successful test-runner evidence
    // earlier in the run, transition the task to Done in storage and
    // **replace** the broadcast payload with a synthetic
    // `task_completed`. Doing this before any broadcast avoids
    // briefly showing the failure to live subscribers when we already
    // know we're going to override it.
    let mut effective_event_type: &str = event_type;
    let mut broadcast_payload = enriched;
    if event_type == "task_failed" {
        if let (Some(task_id_str), Some(jwt)) = (task_id.as_deref(), jwt) {
            if let Some(synthetic) = failure::maybe_apply_test_evidence_override(
                state,
                project_id,
                agent_instance_id,
                task_id_str,
                jwt,
                &event,
                session_id,
            )
            .await
            {
                broadcast_payload = synthetic;
                effective_event_type = "task_completed";
            }
        }
    }

    // Build-as-truth gate (opt-in via `AURA_BUILD_GATE`). The inverse
    // of the tests-as-truth override above: when the harness reports
    // `task_completed` but the workspace doesn't `cargo check` cleanly,
    // demote the event to `task_failed` BEFORE broadcasting so the
    // dashboard never briefly shows a successful verdict the server is
    // about to overwrite. See `signals::build_preflight` for the
    // verdict shape, the timeout, and the env-var contract.
    if effective_event_type == "task_completed" && build_gate_enabled() {
        if let Some(preflight) =
            maybe_run_build_gate(state, project_id, agent_instance_id).await
        {
            if !preflight.ok {
                broadcast_payload =
                    synthesize_build_gate_failure(&broadcast_payload, &preflight);
                effective_event_type = "task_failed";
                tracing::warn!(
                    %project_id,
                    %agent_instance_id,
                    elapsed_ms = preflight.elapsed.as_millis() as u64,
                    first_error_code = preflight.first_error_code.as_deref().unwrap_or("unknown"),
                    timed_out = preflight.timed_out,
                    "build preflight demoted task_completed to task_failed"
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
                set_current_task(
                    state,
                    project_id,
                    agent_instance_id,
                    loop_handle,
                    Some(task_id.to_string()),
                )
                .await;
                // Mirror the forwarder's session_id onto the storage
                // `tasks.session_id` column so the cold-read path in
                // `persist_task_output` (and `fetch_task_output_from_storage`)
                // can resolve it after the in-memory cache is evicted.
                // The harness owns task transitions in production, so
                // `TaskService::assign_task` â€” the only other writer of
                // this field â€” is never reached for automation /
                // `run_single_task` runs. Best-effort and idempotent: any
                // storage failure is logged at warn level, the live run
                // continues, and the in-memory cache stamp above still
                // covers the warm completion path.
                if let (Some(session_id), Some(jwt)) = (session_id, jwt) {
                    stamp_task_session_id_in_storage(state, jwt, task_id, session_id).await;
                }
                // Increment `tasks_worked_count` on the storage session
                // so per-session stats reflect automation activity too.
                if let Some(session_id) = session_id {
                    record_task_worked(
                        &state.session_service,
                        project_id,
                        agent_instance_id,
                        session_id,
                        task_id,
                    )
                    .await;
                }
            }
        }
        "task_completed" => {
            set_current_task(state, project_id, agent_instance_id, loop_handle, None).await;
            // Clear the per-task retry counters now that the task has
            // reached a clean terminal: a subsequent run of the same
            // task (e.g. via the manual rerun path) starts from a
            // fresh budget rather than inheriting stale failures.
            if let Some(task_uuid) = task_id.and_then(|s| TaskId::from_str(s).ok()) {
                retry_state.tool_retry.clear(task_uuid);
                retry_state.task_retry.clear(task_uuid);
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
            set_current_task(state, project_id, agent_instance_id, loop_handle, None).await;
            // Persist the fail reason onto `tasks.execution_notes` so
            // it survives a page reload. The live WebSocket path
            // already carries the reason to `useTaskStatus`, but that
            // state resets to `null` on mount; without this write,
            // "Copy All Output" on a reloaded failed task has no
            // reason to render (the hook has nothing to seed from).
            //
            // Section B: when the harness emits `task_failed` without
            // a usable reason field, the persistence helper falls
            // back to `synthesize_failure_reason` so the row never
            // shows the silent "Task failed without producing
            // output" state on reload.
            if let (Some(task_id), Some(jwt)) = (task_id, jwt) {
                failure::persist_task_failure_reason(state, jwt, task_id, event).await;
                // Same accumulator drain as task_completed: failed tasks
                // also have token usage that should appear in stats.
                task_output::persist_cached_task_output(state, project_id, jwt, task_id).await;
                // Section E: task-level auto-retry. We only push the
                // task back to `Ready` when the failure reason is
                // retryable (transient classifier accepted it) and
                // the per-task task-level budget has not been
                // exhausted. On `GiveUp` the task stays `Failed` and
                // the existing surfaces handle it.
                retry::maybe_apply_task_level_retry(
                    state,
                    jwt,
                    task_id,
                    event,
                    retry_state,
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
        "tool_result" => {
            // Section D: track tool-call failures against
            // `TOOL_CALL_RETRY_BUDGET`. On `Retry`, emit a
            // `task_retrying` UI signal carrying the current attempt
            // count so the surface can render the recovery state.
            // On `GiveUp`, fall through silently â€” the
            // `task_failed` arm (above) will fire next and handle
            // the terminal path.
            if let Some(task_id) = task_id {
                retry::maybe_track_tool_call_failure(
                    state,
                    project_id,
                    agent_instance_id,
                    task_id,
                    event,
                    retry_state,
                    session_id,
                )
                .await;
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

/// Best-effort mirror of the forwarder's `session_id` onto the
/// storage `tasks.session_id` column.
///
/// Runs from the `task_started` arm of `apply_event_side_effect` and
/// keeps the persisted task row in lockstep with the in-memory cache
/// stamp, so the cold-read fallback inside
/// `crate::persistence::persist_task_output` (and the
/// `fetch_task_output_from_storage` reader) finds the session id even
/// if the in-memory cache was evicted before the task completed.
///
/// The harness is authoritative for task transitions in production:
/// `TaskService::assign_task` (the only other writer of this column)
/// is only reached from tests via `claim_next_task`. Without this
/// stamp the column stays `NULL` for every automation /
/// `run_single_task` run, which is exactly the state that produced
/// the `session_id missing from both cache and task document`
/// warnings on terminal events.
async fn stamp_task_session_id_in_storage(
    state: &AppState,
    jwt: &str,
    task_id: &str,
    session_id: SessionId,
) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    let update = aura_os_storage::UpdateTaskRequest {
        session_id: Some(session_id.to_string()),
        ..Default::default()
    };
    if let Err(error) = storage.update_task(task_id, jwt, &update).await {
        tracing::warn!(
            task_id,
            %session_id,
            %error,
            "failed to stamp session_id on task row at task_started; cold-read fallback may miss"
        );
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
pub(super) fn log_line_for_event(
    event_type: &str,
    event: &serde_json::Value,
) -> Option<String> {
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

/// Resolve the workspace path for the run and shell out to
/// `cargo check` on a blocking task so the async forwarder isn't
/// stalled by IO. Returns `None` when the gate is enabled but we
/// couldn't resolve a workspace path — the caller then proceeds with
/// the harness's verdict unchanged rather than synthesising a
/// failure against a missing workspace.
async fn maybe_run_build_gate(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
) -> Option<BuildPreflight> {
    let workspace_path =
        resolve_agent_instance_workspace_path(state, &project_id, Some(agent_instance_id))
            .await?;
    let preflight =
        tokio::task::spawn_blocking(move || run_build_preflight(&workspace_path))
            .await
            .ok()?;
    Some(preflight)
}

/// Build a synthetic `task_failed` payload from the original
/// `task_completed` enriched event so downstream
/// `apply_event_side_effect` and the dashboard see a fully-formed
/// failure even though the harness reported success. Keeps every
/// original field intact (task_id, session_id, timestamps, ...) and
/// overlays a structured `reason`, `message`, plus the truncated
/// `cargo check` stderr tail.
fn synthesize_build_gate_failure(
    original: &serde_json::Value,
    preflight: &BuildPreflight,
) -> serde_json::Value {
    let mut payload = original.clone();
    let reason = render_demoted_failure_reason(preflight);
    if let Some(object) = payload.as_object_mut() {
        object.insert("type".into(), serde_json::Value::from("task_failed"));
        object.insert("event_type".into(), serde_json::Value::from("task_failed"));
        object.insert("reason".into(), serde_json::Value::from(reason.clone()));
        object.insert("message".into(), serde_json::Value::from(reason));
        object.insert(
            "build_preflight_stderr".into(),
            serde_json::Value::from(preflight.stderr_tail.clone()),
        );
        if let Some(code) = preflight.first_error_code.as_ref() {
            object.insert(
                "build_preflight_error_code".into(),
                serde_json::Value::from(code.clone()),
            );
        }
        object.insert(
            "build_preflight_elapsed_ms".into(),
            serde_json::Value::from(u64::try_from(preflight.elapsed.as_millis()).unwrap_or(0)),
        );
        if preflight.timed_out {
            object.insert("build_preflight_timed_out".into(), serde_json::Value::Bool(true));
        }
    }
    payload
}

/// Extract `(input_tokens, output_tokens)` from an
/// `assistant_message_end` payload. Looks under both the top-level
/// fields the legacy harness emits and the nested `usage` object the
/// post-Phase 4 harness uses.
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
mod build_gate_synthesizer_tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn synthesize_build_gate_failure_overlays_failure_fields_on_original() {
        let original = serde_json::json!({
            "type": "task_completed",
            "event_type": "task_completed",
            "task_id": "task-123",
            "session_id": "ses-456",
            "timestamp": "2026-05-19T22:00:00Z",
            "extra": "preserve me"
        });
        let preflight = BuildPreflight {
            ok: false,
            first_error_code: Some("E0432".to_string()),
            stderr_tail: "error[E0432]: unresolved import".to_string(),
            elapsed: Duration::from_millis(1234),
            timed_out: false,
        };
        let synthetic = synthesize_build_gate_failure(&original, &preflight);
        assert_eq!(synthetic["type"], "task_failed");
        assert_eq!(synthetic["event_type"], "task_failed");
        assert_eq!(synthetic["task_id"], "task-123");
        assert_eq!(synthetic["session_id"], "ses-456");
        assert_eq!(synthetic["extra"], "preserve me");
        let reason = synthetic["reason"].as_str().expect("reason set");
        assert!(reason.starts_with("build_preflight_failed:"));
        assert!(reason.contains("error[E0432]"));
        assert_eq!(synthetic["build_preflight_error_code"], "E0432");
        assert_eq!(synthetic["build_preflight_elapsed_ms"], 1234);
        assert!(synthetic.get("build_preflight_timed_out").is_none());
    }

    #[test]
    fn synthesize_build_gate_failure_marks_timeout_when_relevant() {
        let original = serde_json::json!({ "task_id": "t" });
        let preflight = BuildPreflight {
            ok: false,
            first_error_code: None,
            stderr_tail: "killed".to_string(),
            elapsed: Duration::from_secs(90),
            timed_out: true,
        };
        let synthetic = synthesize_build_gate_failure(&original, &preflight);
        assert_eq!(synthetic["build_preflight_timed_out"], true);
        assert!(synthetic["reason"]
            .as_str()
            .unwrap()
            .contains("timeout after 90s"));
    }
}