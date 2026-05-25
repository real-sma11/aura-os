//! Per-event-type dispatch helpers for the dev-loop side-effects
//! pipeline. The orchestrator in `mod.rs` calls
//! [`apply_event_side_effect`] once per event after enrichment and
//! workspace-health gating; this module owns the thin `match` and the
//! per-arm helpers it routes into. No business logic lives here ---
//! each arm just calls into the existing focused submodule
//! (`failure`, `files`, `git`, `retry`, `task_output`).

use std::str::FromStr;

use aura_os_core::TaskId;

use super::common::{event_text, set_current_task};
use super::super::super::session::record_task_worked;
use super::super::super::signals::snapshot_workspace_health;
use super::{failure, files, git, retry, task_output, SideEffectCtx};
use crate::handlers::projects_helpers::resolve_agent_instance_workspace_path;

/// Route an enriched (and possibly health-gate-demoted) engine event
/// into the per-arm helper that owns the side-effects for that event
/// type. The match is the single source of truth for which event
/// types currently produce a side-effect; everything else falls
/// through to the catch-all and is forwarded only via the upstream
/// broadcast.
pub(super) async fn apply_event_side_effect(
    ctx: &SideEffectCtx<'_>,
    event_type: &str,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    match event_type {
        "task_started" => task_started(ctx, task_id).await,
        "task_completed" => task_completed(ctx, task_id).await,
        "task_failed" => task_failed(ctx, task_id, event).await,
        "tool_call_completed" => tool_call_completed(ctx, task_id, event).await,
        "git_committed" | "commit_created" | "git_commit_failed" | "git_pushed"
        | "push_succeeded" | "git_push_failed" | "push_failed" => {
            git_lifecycle(ctx, task_id, event_type, event).await;
        }
        "text_delta" => text_delta(ctx, task_id, event).await,
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            usage_or_turn_end(ctx, task_id, event_type, event).await;
        }
        _ => {}
    }
}

/// `task_started`: seed the task-output cache, bind the LoopHandle
/// activity pointer, bump `tasks_worked_count` on the session, and
/// kick off the workspace-health baseline snapshot. This arm is the
/// single writer of `tasks.session_id`.
async fn task_started(ctx: &SideEffectCtx<'_>, task_id: Option<&str>) {
    let Some(task_id) = task_id else { return };
    task_output::seed_task_output(
        ctx.state,
        ctx.project_id,
        ctx.agent_instance_id,
        ctx.session_id,
        task_id,
    )
    .await;
    set_current_task(ctx.loop_handle, Some(task_id.to_string())).await;
    if let Some(session_id) = ctx.session_id {
        record_task_worked(
            ctx.state,
            ctx.jwt,
            ctx.project_id,
            ctx.agent_instance_id,
            session_id,
            task_id,
        )
        .await;
    }
    spawn_health_baseline_snapshot(ctx, task_id).await;
}

/// Workspace-health baseline. Captures the build state at task start
/// so the completion gate can compare against task_done. Runs in the
/// background so it never adds claim latency; if it doesn't finish
/// before task_done, the gate falls back to "unknown baseline".
async fn spawn_health_baseline_snapshot(ctx: &SideEffectCtx<'_>, task_id: &str) {
    let Ok(task_uuid) = TaskId::from_str(task_id) else {
        return;
    };
    let Some(workspace_path) =
        resolve_agent_instance_workspace_path(ctx.state, &ctx.project_id, Some(ctx.agent_instance_id))
            .await
    else {
        return;
    };
    let retry_state_for_snapshot = ctx.retry_state.clone();
    tokio::spawn(async move {
        let health = snapshot_workspace_health(workspace_path).await;
        retry_state_for_snapshot
            .health_baseline
            .record(task_uuid, health);
    });
}

/// `task_completed`: clear the current-task pointer, drop the
/// workspace-health baseline (so a rerun starts fresh), and drain the
/// in-memory `task_output_cache` into the persisted aura-storage
/// record. Without the drain, tokens accumulated in
/// `update_usage_cache` are silently discarded when the cache is
/// evicted, leaving the dashboard "Tokens" stat at 0.
async fn task_completed(ctx: &SideEffectCtx<'_>, task_id: Option<&str>) {
    set_current_task(ctx.loop_handle, None).await;
    if let Some(task_uuid) = task_id.and_then(|s| TaskId::from_str(s).ok()) {
        ctx.retry_state.health_baseline.clear(task_uuid);
    }
    if let (Some(task_id), Some(jwt)) = (task_id, ctx.jwt) {
        task_output::persist_cached_task_output(ctx.state, ctx.project_id, jwt, task_id).await;
    }
}

/// `task_failed`: clear the current-task pointer and the
/// workspace-health baseline, persist the fail reason onto
/// `tasks.execution_notes` (so "Copy All Output" on a reloaded failed
/// task has something to render), drain the token-usage cache, and
/// finally dispatch to the task-level auto-retry helper which decides
/// whether to push the task back to `Ready` based on
/// `HarnessFailureKind::is_retryable` and the persisted attempts
/// counter.
async fn task_failed(
    ctx: &SideEffectCtx<'_>,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    set_current_task(ctx.loop_handle, None).await;
    if let Some(task_uuid) = task_id.and_then(|s| TaskId::from_str(s).ok()) {
        ctx.retry_state.health_baseline.clear(task_uuid);
    }
    let (Some(task_id), Some(jwt)) = (task_id, ctx.jwt) else {
        return;
    };
    failure::persist_task_failure_reason(ctx.state, jwt, task_id, event).await;
    task_output::persist_cached_task_output(ctx.state, ctx.project_id, jwt, task_id).await;
    retry::maybe_apply_task_level_retry(
        ctx.state,
        jwt,
        task_id,
        event,
        ctx.project_id,
        ctx.agent_instance_id,
        ctx.session_id,
    )
    .await;
}

/// `tool_call_completed`: record test-pass evidence (so a completion
/// that claims tests pass can be verified against the harness's
/// actual tool calls) and stamp git push/commit timeouts on the task
/// row for the dashboard.
async fn tool_call_completed(
    ctx: &SideEffectCtx<'_>,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    let Some(task_id) = task_id else { return };
    task_output::record_test_pass_evidence(ctx.state, ctx.project_id, task_id, event).await;
    git::record_git_commit_push_timeout(ctx.state, ctx.project_id, task_id, event).await;
}

/// Git checkpoint events (commit / push, success / failure). Each
/// arm fans out to the same persistence helper which records the
/// checkpoint kind verbatim so the dashboard can render the git
/// activity timeline.
async fn git_lifecycle(
    ctx: &SideEffectCtx<'_>,
    task_id: Option<&str>,
    event_type: &str,
    event: &serde_json::Value,
) {
    let Some(task_id) = task_id else { return };
    git::record_git_checkpoint(ctx.state, ctx.project_id, task_id, event_type, event).await;
}

/// `text_delta`: append the streamed text fragment to the per-task
/// live-output buffer so the dashboard's "Live Output" panel renders
/// the LLM's running response without waiting for the assistant turn
/// to end.
async fn text_delta(
    ctx: &SideEffectCtx<'_>,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    if let Some((task_id, text)) = task_id.zip(event_text(event)) {
        task_output::append_task_output(ctx.state, ctx.project_id, task_id, text).await;
    }
}

/// Usage / turn-end events: update the in-memory token-usage cache
/// for the active task and, on `assistant_message_end`, also record
/// the cross-turn files-changed set so the dashboard's files-touched
/// count merges across turns instead of being overwritten by the
/// last turn's view.
async fn usage_or_turn_end(
    ctx: &SideEffectCtx<'_>,
    task_id: Option<&str>,
    event_type: &str,
    event: &serde_json::Value,
) {
    if let Some(task_id) = task_id {
        task_output::update_usage_cache(ctx.state, ctx.project_id, task_id, event).await;
    }
    if event_type == "assistant_message_end" {
        if let Some(task_id) = task_id {
            files::record_files_changed(ctx.state, ctx.project_id, task_id, event).await;
        }
    }
}