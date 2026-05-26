//! Spawns the harness-event consumer task that drives `LoopHandle`
//! activity, persists side-effects, surfaces live heuristics, and
//! shadows the broadcast into the chat persist pipeline.
//!
//! Internally split into three phases so each fits inside the
//! per-function line budget the `rules-rust.md` style guide enforces:
//!
//! * [`run_forwarder_setup`] destructures the `ForwarderContext`, spawns
//!   the chat-pipeline persist subscriber and the side-effects event
//!   worker, emits the startup `log_line`, and returns the artifacts
//!   needed for the next two phases.
//! * [`run_forwarder_event_loop`] drives `collect_automaton_events`,
//!   relaying every harness event into the worker, and awaits the
//!   worker once the upstream stream ends.
//! * [`run_forwarder_teardown`] flips `alive=false`, removes the
//!   registry slot, marks the `LoopHandle` completed/failed, ends the
//!   storage `Session`, and emits the terminal `log_line` /
//!   `loop_finished` events.

use std::str::FromStr;
use std::sync::{
    atomic::{AtomicBool, AtomicI64, Ordering},
    Arc,
};
use std::time::Duration;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, SessionStatus, TaskId};
use aura_os_harness::{collect_automaton_events, RunCompletion, WsReaderHandle};
use aura_os_loops::LoopHandle;
use tokio::sync::{broadcast, mpsc};
use tracing::{debug, info, warn};

use crate::handlers::agents::chat::{spawn_dev_loop_persist_task, ChatPersistCtx};
use crate::handlers::live_heuristics::{emit_live_heuristic, LiveAnalyzer};
use crate::loop_log::RunStatus;
use crate::state::AppState;

use super::super::session::end_session;
use super::super::signals::is_insufficient_credits_failure;
use super::super::types::{ForwarderContext, LoopRetryState};
use super::{
    activity, credits, emit_domain_event_with_session, emit_log_line, side_effects,
    DomainEventInputs, LogLineInputs,
};

/// Per-forwarder state that survives across all three lifecycle
/// phases. Holds the moves the orchestrator drains from the
/// `ForwarderContext` plus the drop-guards that must outlive the
/// event loop (the persist task and the harness `WsReaderHandle`).
struct ForwarderRuntimeState {
    state: AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: String,
    session_id: Option<SessionId>,
    alive: Arc<AtomicBool>,
    loop_handle: Arc<LoopHandle>,
    // Held alive for the entire forwarder task body. Dropped on
    // normal completion (closes the harness ws via the safety net
    // on the last `WsReaderHandle` clone) and on abort.
    // `abort_and_remove` also holds a clone via
    // `ActiveAutomaton.ws_reader_handle` and calls `cancel()` on it
    // explicitly to short-circuit the wait, so the upstream ws-slot
    // is released immediately on stop instead of after this task
    // fully unwinds.
    _ws_reader_handle: WsReaderHandle,
    // Chat-pipeline persist subscriber, if active. Kept as a drop
    // guard so the subscriber gets aborted when this struct is
    // consumed by teardown.
    _persist_handle: Option<tokio::task::JoinHandle<()>>,
}

/// Pieces of state that are *only* needed during the event loop
/// phase: the broadcast receiver `collect_automaton_events` consumes,
/// the mpsc into the side-effects worker, the worker handle to await
/// after the upstream closes, the configured stream timeout, and the
/// credit-exhaustion latch so the inner closure only fires the
/// guarded shutdown once per run.
struct EventLoopArtifacts {
    rx: broadcast::Receiver<serde_json::Value>,
    event_task_tx: mpsc::UnboundedSender<(serde_json::Value, String)>,
    event_worker: tokio::task::JoinHandle<()>,
    timeout: Duration,
    credit_stop_requested: Arc<AtomicBool>,
}

/// Inputs for [`spawn_event_worker`]. Bundled so the helper signature
/// stays inside the project's five-parameter ceiling.
struct EventWorkerInputs {
    state: AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    loop_handle: Arc<LoopHandle>,
    jwt: Option<Arc<String>>,
    session_id: Option<SessionId>,
    fallback_task_id: Option<String>,
    retry_state: Arc<LoopRetryState>,
    last_forwarder_event_at: Arc<AtomicI64>,
    event_rx: mpsc::UnboundedReceiver<(serde_json::Value, String)>,
}

pub(crate) fn spawn_event_forwarder(ctx: ForwarderContext) -> tokio::task::AbortHandle {
    let handle = tokio::spawn(async move {
        let (runtime, artifacts) = run_forwarder_setup(ctx);
        let completion = run_forwarder_event_loop(&runtime, artifacts).await;
        run_forwarder_teardown(runtime, completion).await;
    });
    handle.abort_handle()
}

/// Phase 1: drain the `ForwarderContext`, spawn the chat-persist
/// subscriber and the side-effects event worker, emit the startup
/// `log_line`, and return everything the other two phases will need.
///
/// The chat-persist subscriber attaches when storage + JWT + session
/// are all present so dev-loop harness events become `SessionEvent`
/// rows; without any of those the dev loop still runs, we just don't
/// persist a SessionEvent timeline for this run.
fn run_forwarder_setup(ctx: ForwarderContext) -> (ForwarderRuntimeState, EventLoopArtifacts) {
    let ForwarderContext {
        state,
        project_id,
        agent_instance_id,
        automaton_id,
        task_id,
        events_tx,
        ws_reader_handle,
        alive,
        timeout,
        loop_handle,
        jwt,
        session_id,
        retry_state,
        last_forwarder_event_at,
    } = ctx;
    info!(
        target: "aura::automation",
        %project_id,
        %agent_instance_id,
        automaton_id = %automaton_id,
        task_id = task_id.as_deref().unwrap_or(""),
        timeout_secs = timeout.as_secs(),
        "forwarder listening for harness events"
    );
    let jwt = jwt.map(Arc::new);
    let pipeline = prepare_event_pipeline(EventPipelineInputs {
        state: &state,
        events_tx: &events_tx,
        project_id,
        agent_instance_id,
        loop_handle: &loop_handle,
        jwt: &jwt,
        session_id,
        task_id,
        retry_state,
        last_forwarder_event_at,
    });
    let runtime = make_runtime_state(MakeRuntimeStateInputs {
        state,
        project_id,
        agent_instance_id,
        automaton_id,
        session_id,
        alive,
        loop_handle,
        ws_reader_handle,
        persist_handle: pipeline.persist_handle,
    });
    let artifacts = EventLoopArtifacts {
        rx: pipeline.rx,
        event_task_tx: pipeline.event_task_tx,
        event_worker: pipeline.event_worker,
        timeout,
        credit_stop_requested: Arc::new(AtomicBool::new(false)),
    };
    (runtime, artifacts)
}

/// Bundled inputs for [`prepare_event_pipeline`].
struct EventPipelineInputs<'a> {
    state: &'a AppState,
    events_tx: &'a broadcast::Sender<serde_json::Value>,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    loop_handle: &'a Arc<LoopHandle>,
    jwt: &'a Option<Arc<String>>,
    session_id: Option<SessionId>,
    task_id: Option<String>,
    retry_state: Arc<LoopRetryState>,
    last_forwarder_event_at: Arc<AtomicI64>,
}

/// Output of [`prepare_event_pipeline`]: the persist task, the broadcast
/// receiver wired to the event worker, the unbounded mpsc sender used to
/// hand events off to the worker, and the worker's [`JoinHandle`].
struct EventPipeline {
    persist_handle: Option<tokio::task::JoinHandle<()>>,
    rx: broadcast::Receiver<serde_json::Value>,
    event_task_tx: mpsc::UnboundedSender<(serde_json::Value, String)>,
    event_worker: tokio::task::JoinHandle<()>,
}

/// Spawn the dev-loop persist task, emit the startup log line, subscribe
/// to the harness broadcast, and spawn the event worker. Carved out of
/// [`run_forwarder_setup`] so that body fits the 50-line per-function
/// budget; ordering of side-effects is preserved verbatim.
fn prepare_event_pipeline(inputs: EventPipelineInputs<'_>) -> EventPipeline {
    let EventPipelineInputs {
        state,
        events_tx,
        project_id,
        agent_instance_id,
        loop_handle,
        jwt,
        session_id,
        task_id,
        retry_state,
        last_forwarder_event_at,
    } = inputs;
    let persist_handle = maybe_spawn_dev_loop_persist(DevLoopPersistInputs {
        state,
        events_tx,
        project_id,
        agent_instance_id,
        jwt: jwt.as_deref().map(|s| s.as_str()),
        session_id,
    });
    let rx = events_tx.subscribe();
    emit_startup_log_line(
        state,
        project_id,
        agent_instance_id,
        session_id,
        task_id.as_deref(),
    );
    let (event_task_tx, event_task_rx) = mpsc::unbounded_channel();
    let event_worker = spawn_event_worker(EventWorkerInputs {
        state: state.clone(),
        project_id,
        agent_instance_id,
        loop_handle: loop_handle.clone(),
        jwt: jwt.clone(),
        session_id,
        fallback_task_id: task_id,
        retry_state,
        last_forwarder_event_at,
        event_rx: event_task_rx,
    });
    EventPipeline {
        persist_handle,
        rx,
        event_task_tx,
        event_worker,
    }
}

/// Bundled inputs for [`make_runtime_state`]. Pulled out so the
/// setup-phase call site stays within the project's
/// five-parameter ceiling.
struct MakeRuntimeStateInputs {
    state: AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: String,
    session_id: Option<SessionId>,
    alive: Arc<AtomicBool>,
    loop_handle: Arc<LoopHandle>,
    ws_reader_handle: WsReaderHandle,
    persist_handle: Option<tokio::task::JoinHandle<()>>,
}

/// Project moved fields onto a fresh [`ForwarderRuntimeState`].
/// Carved out of [`run_forwarder_setup`] so the setup body stays
/// inside the 50-line per-function budget while still owning every
/// drop-guard the run depends on for the lifetime of the event loop
/// and teardown phases.
fn make_runtime_state(inputs: MakeRuntimeStateInputs) -> ForwarderRuntimeState {
    let MakeRuntimeStateInputs {
        state,
        project_id,
        agent_instance_id,
        automaton_id,
        session_id,
        alive,
        loop_handle,
        ws_reader_handle,
        persist_handle,
    } = inputs;
    ForwarderRuntimeState {
        state,
        project_id,
        agent_instance_id,
        automaton_id,
        session_id,
        alive,
        loop_handle,
        _ws_reader_handle: ws_reader_handle,
        _persist_handle: persist_handle,
    }
}

/// Emit the startup `Listening for harness events` log line.
///
/// Carved out of [`run_forwarder_setup`] so the setup phase stays
/// inside the per-function line budget; otherwise the message /
/// extra construction adds another ~15 lines to an already
/// tightly-packed setup body.
fn emit_startup_log_line(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    task_id: Option<&str>,
) {
    let message = match task_id {
        Some(task_id) => format!(
            "Listening for harness events (task {})",
            short_task_id(task_id)
        ),
        None => "Listening for harness events".to_string(),
    };
    let extra = task_id.map_or_else(
        || serde_json::json!({}),
        |task_id| serde_json::json!({ "task_id": task_id }),
    );
    emit_log_line(LogLineInputs {
        state,
        project_id,
        agent_instance_id,
        session_id,
        message,
        extra,
    });
}

/// Spawn the side-effects worker task. Pulled out of
/// [`run_forwarder_setup`] so the setup phase stays inside the
/// per-function line budget.
///
/// The worker drains the mpsc populated from the closure inside
/// [`run_forwarder_event_loop`], stamps `last_forwarder_event_at`
/// BEFORE doing work so a slow side-effect path doesn't make the
/// forwarder look stale to `can_reuse_forwarder`, and dispatches
/// every event through the [`side_effects`] pipeline plus
/// per-loop-log / live-heuristics / loop-activity bookkeeping.
fn spawn_event_worker(inputs: EventWorkerInputs) -> tokio::task::JoinHandle<()> {
    let EventWorkerInputs {
        state,
        project_id,
        agent_instance_id,
        loop_handle,
        jwt,
        session_id,
        fallback_task_id,
        retry_state,
        last_forwarder_event_at,
        mut event_rx,
    } = inputs;
    tokio::spawn(async move {
        let mut live_analyzer = LiveAnalyzer::new();
        while let Some((event, event_type)) = event_rx.recv().await {
            last_forwarder_event_at.store(current_millis(), Ordering::Relaxed);
            handle_forwarder_event(
                EventHandlerInputs {
                    state: &state,
                    project_id,
                    agent_instance_id,
                    loop_handle: &loop_handle,
                    jwt: jwt.as_deref().map(|s| s.as_str()),
                    session_id,
                    fallback_task_id: fallback_task_id.clone(),
                    retry_state: &retry_state,
                },
                &mut live_analyzer,
                event,
                event_type,
            )
            .await;
        }
    })
}

/// Inputs for [`handle_forwarder_event`]. Bundled so the per-event
/// dispatch helper stays inside the project's five-parameter ceiling.
struct EventHandlerInputs<'a> {
    state: &'a AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    loop_handle: &'a LoopHandle,
    jwt: Option<&'a str>,
    session_id: Option<SessionId>,
    fallback_task_id: Option<String>,
    retry_state: &'a Arc<LoopRetryState>,
}

/// Per-event dispatch executed inside the side-effects worker loop.
/// Pulled out of [`spawn_event_worker`] so the worker shell stays
/// inside the per-function line budget while still walking the same
/// loop_log / live-heuristics / activity / side_effects ladder.
async fn handle_forwarder_event(
    inputs: EventHandlerInputs<'_>,
    live_analyzer: &mut LiveAnalyzer,
    event: serde_json::Value,
    event_type: String,
) {
    let EventHandlerInputs {
        state,
        project_id,
        agent_instance_id,
        loop_handle,
        jwt,
        session_id,
        fallback_task_id,
        retry_state,
    } = inputs;
    trace_harness_event(project_id, agent_instance_id, &event_type, &event);
    state
        .loop_log
        .on_json_event(project_id, agent_instance_id, &event)
        .await;
    record_loop_log_task_lifecycle(state, project_id, agent_instance_id, &event_type, &event).await;
    maybe_emit_live_heuristics(state, project_id, agent_instance_id, live_analyzer, &event_type)
        .await;
    activity::apply_loop_activity_event(loop_handle, &event_type, &event).await;
    let ctx = side_effects::SideEffectCtx {
        state,
        project_id,
        agent_instance_id,
        loop_handle,
        jwt,
        session_id,
        retry_state,
    };
    side_effects::record_event_side_effects(&ctx, fallback_task_id, event, &event_type).await;
}

/// Mirror a raw harness event onto the operator-facing `tracing`
/// channel so `aura-os-desktop`'s stderr console actually shows the
/// per-event firehose when an operator wants it. The debug! line
/// fires for every event; the info! line fires only for the
/// tool-call-start family because those have no side-effects arm
/// (so dispatch.rs's lifecycle info! lines never see them) but are
/// the single most useful signal for "the harness is doing
/// something". Bounded payload: only the event type, short task id,
/// and a comma-joined list of top-level keys to keep one event to
/// one log line regardless of payload size.
fn trace_harness_event(
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    event_type: &str,
    event: &serde_json::Value,
) {
    let task_id = event_task_id(event).unwrap_or("");
    debug!(
        target: "aura::automation",
        %project_id,
        %agent_instance_id,
        event_type = event_type,
        task_id = task_id,
        keys = %top_level_keys(event),
        "harness event"
    );
    if matches!(event_type, "tool_call_started" | "tool_use_start") {
        info!(
            target: "aura::automation",
            %project_id,
            %agent_instance_id,
            task_id = task_id,
            tool = %event_tool_name(event),
            "automation tool call started"
        );
    }
}

/// Comma-joined list of top-level keys on `event`, capped so a
/// pathologically wide payload can't blow up a single log line.
/// Returns the empty string for non-object events (the harness
/// always emits objects, but we don't want a panic if a malformed
/// payload sneaks through). Used by `trace_harness_event` to give
/// the operator-facing debug line a one-glance hint at the payload
/// shape without dumping the full JSON.
fn top_level_keys(event: &serde_json::Value) -> String {
    const MAX_KEYS: usize = 12;
    let Some(object) = event.as_object() else {
        return String::new();
    };
    let mut joined = String::new();
    for (i, key) in object.keys().take(MAX_KEYS).enumerate() {
        if i > 0 {
            joined.push(',');
        }
        joined.push_str(key);
    }
    if object.len() > MAX_KEYS {
        joined.push_str(",…");
    }
    joined
}

/// Tool name from a `tool_use_start` / `tool_call_started` payload,
/// falling back to a generic label. Mirrors the private helper in
/// [`super::activity`] — kept inline here so the trace path doesn't
/// reach into the activity module's internals.
fn event_tool_name(event: &serde_json::Value) -> &str {
    event
        .get("tool")
        .and_then(|v| v.as_str())
        .or_else(|| event.get("name").and_then(|v| v.as_str()))
        .or_else(|| event.get("tool_name").and_then(|v| v.as_str()))
        .unwrap_or("tool")
}

/// Phase 2: relay harness events from the broadcast stream into the
/// side-effects worker until the upstream stream ends (timeout,
/// closure, or hard failure). The closure body also fires a one-shot
/// `stop_automaton_for_credit_exhaustion` background task on the
/// first `insufficient_credits` signal so the harness side gets torn
/// down BEFORE this forwarder unwinds and clears the registry slot.
///
/// On return, drops the mpsc sender to flush the worker, awaits its
/// `JoinHandle` (logging at `warn!` on panic), and hands the
/// [`RunCompletion`] off to the teardown phase.
async fn run_forwarder_event_loop(
    runtime: &ForwarderRuntimeState,
    artifacts: EventLoopArtifacts,
) -> RunCompletion {
    let EventLoopArtifacts {
        rx,
        event_task_tx,
        event_worker,
        timeout,
        credit_stop_requested,
    } = artifacts;
    let project_id = runtime.project_id;
    let agent_instance_id = runtime.agent_instance_id;
    let stop_automaton_id = runtime.automaton_id.clone();
    let state_for_closure = runtime.state.clone();
    let completion = collect_automaton_events(rx, timeout, |event, event_type| {
        let state = state_for_closure.clone();
        let event = event.clone();
        let event_type = event_type.to_string();
        let credit_stop_requested = credit_stop_requested.clone();
        let stop_automaton_id = stop_automaton_id.clone();
        if credits::insufficient_credits_event_message(&event_type, &event).is_some()
            && credit_stop_requested
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        {
            let state = state.clone();
            tokio::spawn(async move {
                credits::stop_automaton_for_credit_exhaustion(
                    &state,
                    project_id,
                    agent_instance_id,
                    &stop_automaton_id,
                )
                .await;
            });
        }
        let _ = event_task_tx.send((event, event_type));
    })
    .await;
    drop(event_task_tx);
    if let Err(error) = event_worker.await {
        warn!(%error, "dev-loop forwarder event worker failed");
    }
    completion
}

/// Phase 3: settle the loop's terminal state. Mirrors the harness
/// outcome onto the `LoopHandle`, the `loop_log` writer, the storage
/// `Session` we minted in `start_loop` / `run_single_task`, and
/// finally emits the `Loop ending (<outcome>)` `log_line` plus the
/// `loop_finished` domain event so subscribers (`useTaskStatus`,
/// SidekickLog) see the run wrap up.
///
/// `insufficient_credits` is treated as a successful outcome for
/// `LoopHandle` / `loop_log` bookkeeping (the harness ran to
/// completion, just refused further work for billing reasons) while
/// still flagged on the `loop_finished` payload so the UI can render
/// the credit-exhausted state explicitly.
async fn run_forwarder_teardown(runtime: ForwarderRuntimeState, completion: RunCompletion) {
    let ForwarderRuntimeState {
        state,
        project_id,
        agent_instance_id,
        automaton_id,
        session_id,
        alive,
        loop_handle,
        _ws_reader_handle,
        _persist_handle,
    } = runtime;
    alive.store(false, Ordering::SeqCst);
    credits::remove_matching_registry_entry(&state, project_id, agent_instance_id, &automaton_id)
        .await;
    let insufficient_credits_reason = completion
        .failure_message()
        .filter(|message| is_insufficient_credits_failure(message));
    // Terminal methods on `LoopHandle` are idempotent (closed flag);
    // safe to call here even though spawned event handlers may hold
    // their own clones of the shared `Arc<LoopHandle>`.
    let succeeded = insufficient_credits_reason.is_some() || completion.is_success();
    mark_loop_outcome(&loop_handle, succeeded, &completion).await;
    record_loop_end(&state, project_id, agent_instance_id, succeeded).await;
    end_session_if_present(&state, project_id, agent_instance_id, session_id, succeeded).await;
    emit_terminal_events(TerminalEventInputs {
        state: &state,
        project_id,
        agent_instance_id,
        session_id,
        insufficient_credits_reason,
        succeeded,
        completion: &completion,
    });
}

/// Persist the terminal loop status to the per-loop run log. Carved
/// out of [`run_forwarder_teardown`] so the teardown body stays
/// inside the 50-line per-function budget.
async fn record_loop_end(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    succeeded: bool,
) {
    state
        .loop_log
        .on_loop_ended(
            project_id,
            agent_instance_id,
            if succeeded {
                RunStatus::Completed
            } else {
                RunStatus::Failed
            },
        )
        .await;
}

/// Bundled inputs for [`emit_terminal_events`].
struct TerminalEventInputs<'a> {
    state: &'a AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    insufficient_credits_reason: Option<&'a str>,
    succeeded: bool,
    completion: &'a RunCompletion,
}

/// Emit the terminal `log_line` and `loop_finished` envelopes.
/// Carved out of [`run_forwarder_teardown`] so the teardown body
/// stays inside the 50-line per-function budget while keeping the
/// per-payload shape verbatim with the pre-refactor code.
fn emit_terminal_events(inputs: TerminalEventInputs<'_>) {
    let TerminalEventInputs {
        state,
        project_id,
        agent_instance_id,
        session_id,
        insufficient_credits_reason,
        succeeded,
        completion,
    } = inputs;
    let terminal_outcome = terminal_outcome_label(insufficient_credits_reason, succeeded, completion);
    info!(
        target: "aura::automation",
        %project_id,
        %agent_instance_id,
        succeeded,
        outcome = %terminal_outcome,
        reason = completion.failure_message().unwrap_or(""),
        "automation loop finished"
    );
    emit_log_line(LogLineInputs {
        state,
        project_id,
        agent_instance_id,
        session_id,
        message: format!("Loop ending ({terminal_outcome})"),
        extra: serde_json::json!({}),
    });
    emit_domain_event_with_session(DomainEventInputs {
        state,
        event_type: "loop_finished",
        project_id,
        agent_instance_id,
        session_id,
        extra: loop_finished_extra(insufficient_credits_reason, succeeded, completion),
    });
}

/// Drive the per-loop terminal status onto the shared `LoopHandle`.
/// Carved out of [`run_forwarder_teardown`] so the teardown body
/// stays under the function-size budget.
async fn mark_loop_outcome(handle: &LoopHandle, succeeded: bool, completion: &RunCompletion) {
    if succeeded {
        handle.mark_completed().await;
    } else {
        handle
            .mark_failed(completion.failure_message().map(str::to_string))
            .await;
    }
}

/// Mirror the harness loop outcome onto the storage `Session` we
/// minted in `start_loop` / `run_single_task`. No-op when no session
/// was minted for this run (tests or storage-less paths).
async fn end_session_if_present(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    succeeded: bool,
) {
    let Some(session_id) = session_id else {
        return;
    };
    let status = if succeeded {
        SessionStatus::Completed
    } else {
        SessionStatus::Failed
    };
    end_session(
        &state.session_service,
        project_id,
        agent_instance_id,
        session_id,
        status,
    )
    .await;
}

/// Human-readable terminal-state label for the `Loop ending (...)`
/// `log_line`. Mirrors the same precedence the legacy inline branch
/// used: insufficient_credits beats success beats failure-with-reason
/// beats bare `failed`.
fn terminal_outcome_label(
    insufficient_credits_reason: Option<&str>,
    succeeded: bool,
    completion: &RunCompletion,
) -> String {
    if let Some(reason) = insufficient_credits_reason {
        return format!("insufficient credits: {reason}");
    }
    if succeeded {
        return "completed".to_string();
    }
    completion.failure_message().map_or_else(
        || "failed".to_string(),
        |reason| format!("failed: {reason}"),
    )
}

/// Build the JSON `extra` payload for the terminal `loop_finished`
/// domain event. Same precedence as [`terminal_outcome_label`] so the
/// machine-readable event and the human log line never disagree on
/// which terminal state the loop landed in.
fn loop_finished_extra(
    insufficient_credits_reason: Option<&str>,
    succeeded: bool,
    completion: &RunCompletion,
) -> serde_json::Value {
    if let Some(reason) = insufficient_credits_reason {
        return serde_json::json!({
            "outcome": "insufficient_credits",
            "reason": reason,
        });
    }
    if succeeded {
        return serde_json::json!({"outcome": "completed"});
    }
    serde_json::json!({
        "outcome": "failed",
        "reason": completion.failure_message(),
    })
}

/// Truncate a UUID-shaped task id for log output. Returns the first
/// 8 chars (or the entire id when shorter) so a log row stays
/// readable without pasting a full 36-character UUID into every
/// "Listening for harness events" line.
fn short_task_id(task_id: &str) -> &str {
    let len = task_id.len().min(8);
    &task_id[..len]
}

/// Wall-clock millis since the unix epoch, saturating to 0 on the
/// (impossible-in-practice) pre-epoch error path. Used by the
/// forwarder to stamp `last_forwarder_event_at` and by
/// `can_reuse_forwarder` to evaluate freshness, so both sides MUST
/// read from the same monotonic-ish clock domain - wall clock is
/// good enough here because freshness is compared against a
/// generous threshold and we only care about drops on the order of
/// tens of seconds.
pub(crate) fn current_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Inputs for [`maybe_spawn_dev_loop_persist`]. Bundled so the helper
/// signature stays inside the 5-parameter limit while still pulling
/// every field the [`ChatPersistCtx`] needs.
struct DevLoopPersistInputs<'a> {
    state: &'a AppState,
    events_tx: &'a broadcast::Sender<serde_json::Value>,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    jwt: Option<&'a str>,
    session_id: Option<SessionId>,
}

/// Spawn the chat-pipeline persist task subscribed to the dev-loop's
/// harness event broadcast. Returns `None` when any precondition for
/// chat persistence is missing (storage client unset, no JWT
/// captured, or no `SessionId` minted) - the dev-loop runs to
/// completion either way; we just won't write `SessionEvent` rows
/// for this run. See module-level doc on
/// [`crate::handlers::agents::chat::spawn_dev_loop_persist_task`]
/// for the contract and rationale.
fn maybe_spawn_dev_loop_persist(
    inputs: DevLoopPersistInputs<'_>,
) -> Option<tokio::task::JoinHandle<()>> {
    let storage = inputs.state.storage_client.as_ref()?.clone();
    let jwt = inputs.jwt?.to_string();
    let session_id = inputs.session_id?;
    let ctx = ChatPersistCtx {
        storage,
        jwt,
        session_id,
        project_id: inputs.project_id.to_string(),
        project_agent_id: inputs.agent_instance_id.to_string(),
        agent_id: None,
        originating_agent_id: None,
        cross_agent_depth: 0,
        from_agent_id: None,
    };
    Some(spawn_dev_loop_persist_task(
        inputs.events_tx.subscribe(),
        ctx,
    ))
}

async fn maybe_emit_live_heuristics(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    live_analyzer: &mut LiveAnalyzer,
    event_type: &str,
) {
    let Some((run_id, run_dir)) = state
        .loop_log
        .active_bundle(project_id, agent_instance_id)
        .await
    else {
        return;
    };

    live_analyzer.note_event(event_type);
    if !live_analyzer.should_run() {
        return;
    }
    let findings = live_analyzer.maybe_analyze(&run_dir);

    if let Some(findings) = findings {
        for finding in findings {
            emit_live_heuristic(state, &finding, project_id, agent_instance_id, &run_id);
        }
    }
}

async fn record_loop_log_task_lifecycle(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    event_type: &str,
    event: &serde_json::Value,
) {
    let Some(task_id) = event_task_id(event) else {
        return;
    };
    let Ok(task_id) = TaskId::from_str(task_id) else {
        return;
    };

    match event_type {
        "task_started" => {
            let task_name = event
                .get("task_title")
                .and_then(|v| v.as_str())
                .or_else(|| event.get("task_name").and_then(|v| v.as_str()))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            state
                .loop_log
                .on_task_started(project_id, agent_instance_id, task_id, task_name, None)
                .await;
        }
        "task_completed" | "task_failed" => {
            let output = task_output_snapshot(state, project_id, task_id)
                .await
                .unwrap_or_default();
            state.loop_log.on_task_end(task_id, &output).await;
        }
        _ => {}
    }
}

fn event_task_id(event: &serde_json::Value) -> Option<&str> {
    event.get("task_id").and_then(|value| value.as_str())
}

async fn task_output_snapshot(
    state: &AppState,
    project_id: ProjectId,
    task_id: TaskId,
) -> Option<String> {
    state
        .task_output_cache
        .lock()
        .await
        .get(&(project_id, task_id))
        .map(|entry| entry.live_output.clone())
}

#[cfg(test)]
mod top_level_keys_tests {
    use super::{event_tool_name, top_level_keys};
    use serde_json::json;

    #[test]
    fn joins_object_keys_with_commas() {
        let event = json!({ "type": "task_started", "task_id": "abc", "name": "init" });
        // `serde_json::Map`'s iteration order depends on the
        // `preserve_order` feature flag; we deliberately do not pin
        // it here. What matters for the operator-facing log is that
        // every key appears exactly once, comma-separated.
        let joined = top_level_keys(&event);
        let mut parts: Vec<&str> = joined.split(',').collect();
        parts.sort_unstable();
        assert_eq!(parts, vec!["name", "task_id", "type"]);
    }

    #[test]
    fn returns_empty_for_non_object() {
        assert_eq!(top_level_keys(&json!("string event")), "");
        assert_eq!(top_level_keys(&json!(42)), "");
        assert_eq!(top_level_keys(&json!([1, 2])), "");
    }

    #[test]
    fn caps_at_twelve_keys_with_ellipsis_marker() {
        let mut payload = serde_json::Map::new();
        for i in 0..20 {
            payload.insert(format!("k{i}"), json!(i));
        }
        let joined = top_level_keys(&serde_json::Value::Object(payload));
        // 12 keys, comma-separated, followed by ",…" to signal truncation.
        assert_eq!(joined.matches(',').count(), 12);
        assert!(joined.ends_with(",…"), "expected truncation marker, got {joined}");
    }

    #[test]
    fn event_tool_name_walks_aliases() {
        assert_eq!(event_tool_name(&json!({ "tool": "edit_file" })), "edit_file");
        assert_eq!(event_tool_name(&json!({ "name": "read_file" })), "read_file");
        assert_eq!(
            event_tool_name(&json!({ "tool_name": "run_command" })),
            "run_command",
        );
        assert_eq!(event_tool_name(&json!({})), "tool");
    }
}