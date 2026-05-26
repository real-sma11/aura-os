import { EventType } from "../shared/types/aura-events";
import type { AuraEvent, AuraEventOfType } from "../shared/types/aura-events";
import { useEventStore, getTaskOutput } from "./event-store/index";
import { parseEventContent } from "../shared/utils/event-content";
import {
  ensureEntry,
  createSetters,
  getStreamEntry,
  getThinkingDurationMs,
  streamMetaMap,
} from "../hooks/stream/store";
import { persistTaskTurns } from "./task-turn-cache";
import {
  resetStreamBuffers,
  handleTextDelta,
  handleThinkingDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolResult,
  handleToolCallRetrying,
  handleToolCallFailed,
  handleAssistantTurnBoundary,
  resolveAbandonedPendingToolCalls,
  finalizeStream,
} from "../hooks/stream/handlers";
import { useTaskOutputPanelStore } from "./task-output-panel-store";
import { useTaskStatusStore } from "./task-status-store";
import {
  useContextUsageStore,
  approxTokensFromText,
  mapWireContextBreakdown,
  type WireContextBreakdown,
} from "./context-usage-store";
import { createEventSubscriptionGroup } from "./event-subscription-group";
import type { StreamRefs, StreamSetters } from "../shared/types/stream";
import type { MutableRefObject } from "react";

/* ------------------------------------------------------------------ */
/*  App-scoped task stream subscription bootstrap                      */
/*                                                                     */
/*  Registers WS event subscriptions ONCE per app lifetime (not per    */
/*  component mount). This eliminates the mount race where a task's    */
/*  `TextDelta` events would arrive in the same microtask batch as     */
/*  `TaskStarted`, before `ActiveTaskStream`'s `useEffect` had a       */
/*  chance to register its own subscriptions.                          */
/*                                                                     */
/*  The bootstrap owns:                                                */
/*    - `useTaskOutputPanelStore` entries (add/complete/fail)          */
/*    - per-task stream store entries (text/thinking/tools/timeline)   */
/*                                                                     */
/*  Views subscribe to the stream store as before via                  */
/*  `useStreamingText(streamKey)` etc. `useTaskStream` no longer       */
/*  registers per-component subscriptions.                             */
/* ------------------------------------------------------------------ */

export const TASK_STREAM_KEY_PREFIX = "task:";

export function taskStreamKey(taskId: string): string {
  return `${TASK_STREAM_KEY_PREFIX}${taskId}`;
}

// Tracks per-task `isStreaming` to drive finalizeStream correctly when
// task_completed / task_failed events arrive.
const isStreamingByTask = new Map<string, boolean>();

interface TaskStreamContext {
  key: string;
  refs: StreamRefs;
  setters: StreamSetters;
  abortRef: MutableRefObject<AbortController | null>;
}

function contextForTask(taskId: string): TaskStreamContext {
  const key = taskStreamKey(taskId);
  const meta = ensureEntry(key);
  const setters = createSetters(key);
  const abortRef: MutableRefObject<AbortController | null> = {
    get current() {
      return streamMetaMap.get(key)?.abort ?? null;
    },
    set current(value: AbortController | null) {
      const m = streamMetaMap.get(key);
      if (m) m.abort = value;
    },
  };
  return { key, refs: meta.refs, setters, abortRef };
}

function handleTaskStarted(e: AuraEventOfType<typeof EventType.TaskStarted>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  resetStreamBuffers(refs, setters);
  setters.setIsStreaming(true);
  isStreamingByTask.set(taskId, true);

  // Drop any stale context-usage value from a prior run of the same
  // task id so the header pill on a re-run doesn't flash the previous
  // turn's percentage until the first AssistantMessageEnd lands.
  useContextUsageStore.getState().clearContextUtilization(taskStreamKey(taskId));

  const projectId = e.project_id;
  if (projectId) {
    useTaskOutputPanelStore
      .getState()
      .addTask(taskId, projectId, e.content.task_title, e.agent_id ?? undefined);
  }

  // Update the per-task status store so observers (sidekick preview,
  // RunTaskButton, etc.) flip into "in progress" without each
  // running its own duplicate WS subscription. A new run also
  // clears any previous failure reason so retried tasks don't
  // surface a stale banner from the prior attempt.
  const status = useTaskStatusStore.getState();
  status.setLiveStatus(taskId, "in_progress");
  status.setLiveFailReason(taskId, null);
  if (e.session_id) {
    status.setLiveSessionId(taskId, e.session_id);
  }

  // Synthesise a `transition_task` block so the activity timeline
  // opens with an explicit "ready -> in_progress" card, matching the
  // closing "in_progress -> done" card emitted from `handleTaskCompleted`.
  // Without this the actual status flip done server-side by
  // `assign_task` is invisible: the user only sees text/tool blocks
  // but no record of the lifecycle transition that started the run.
  //
  // Wrapped: the synthetic timeline card is decorative; if the
  // reducer chain it drives throws (e.g. ref bag not initialised
  // when the event lands before any chat hook mounts), it MUST NOT
  // be allowed to interrupt the lifecycle writes above (`addTask`,
  // `setLiveStatus`) — those are what light up the Run panel row
  // and per-task spinner that this whole regression turned off.
  try {
    emitSyntheticTransitionBlock(taskId, {
      fromStatus: "ready",
      toStatus: "in_progress",
      title: e.content.task_title,
    });
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("synthetic transition block emit failed; lifecycle continues", err);
    }
  }
}

/**
 * Append a synthetic, already-resolved `transition_task` tool-call
 * entry to the task stream so the activity timeline renders a
 * dedicated block via the registry-routed
 * [`TaskBlock`](../components/Block/renderers/TaskBlock.tsx) renderer.
 *
 * Mirrors the git-event pattern (`handleGitCommittedEvent`) so the
 * same `handleToolCallStarted` + `handleToolCallSnapshot` +
 * `handleToolResult` reducer chain runs — guaranteeing the synthetic
 * block lands in `events[]` before `finalizeStream` snapshots a run
 * (so the block survives stream pruning + page reloads via
 * `persistTaskTurns`).
 */
function emitSyntheticTransitionBlock(
  taskId: string,
  args: {
    fromStatus: string;
    toStatus: string;
    title?: string;
    isError?: boolean;
    reason?: string;
  },
): void {
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  handleToolCallStarted(refs, setters, { id, name: "transition_task" });
  handleToolCallSnapshot(refs, setters, {
    id,
    name: "transition_task",
    input: {
      task_id: taskId,
      ...(args.title ? { title: args.title } : {}),
      status: args.toStatus,
      from_status: args.fromStatus,
    },
  });
  const summary = `${args.fromStatus} -> ${args.toStatus}`;
  handleToolResult(refs, setters, {
    id,
    name: "transition_task",
    result: args.isError && args.reason ? `${summary}: ${args.reason}` : summary,
    is_error: args.isError ?? false,
  });
}

function handleTextDeltaEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const text = (c.text as string) ?? "";
  if (!text) return;
  const { key, refs, setters } = contextForTask(taskId);
  handleTextDelta(refs, setters, getThinkingDurationMs(key), text);
  useContextUsageStore.getState().bumpEstimatedTokens(key, approxTokensFromText(text));
}

function handleThinkingDeltaEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const thinking = (c.thinking as string) ?? (c.text as string) ?? "";
  if (!thinking) return;
  const { key, refs, setters } = contextForTask(taskId);
  handleThinkingDelta(refs, setters, thinking);
  useContextUsageStore.getState().bumpEstimatedTokens(key, approxTokensFromText(thinking));
}

function handleToolUseStartEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const rawId = typeof c.id === "string" ? c.id.trim() : "";
  handleToolCallStarted(refs, setters, {
    id: rawId || crypto.randomUUID(),
    name: (typeof c.name === "string" && c.name) || "unknown",
  });
}

function handleToolCallSnapshotEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const rawId = typeof c.id === "string" ? c.id.trim() : "";
  if (!rawId) return;
  const { refs, setters } = contextForTask(taskId);
  handleToolCallSnapshot(refs, setters, {
    id: rawId,
    name: (typeof c.name === "string" && c.name) || "unknown",
    input: (c.input as Record<string, unknown>) ?? {},
  });
}

function handleToolResultEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const { key, refs, setters } = contextForTask(taskId);
  handleToolResult(refs, setters, {
    id: c.id as string | undefined,
    name: (c.name as string) ?? "unknown",
    result: (c.result as string) ?? "",
    is_error: (c.is_error as boolean) ?? false,
  });
  if (typeof c.result === "string" && c.result.length > 0) {
    useContextUsageStore
      .getState()
      .bumpEstimatedTokens(key, approxTokensFromText(c.result));
  }
}

/**
 * Route a `ToolCallRetrying` event (from aura-harness, see
 * `AgentLoopEvent::ToolCallRetrying`) into the per-task stream
 * reducers so any live tool card with the matching `tool_use_id`
 * flips into its "Writing retrying (n/max)…" state. Out-of-order
 * deliveries are tolerated — the reducer will create a pending
 * placeholder entry if the start event hasn't arrived yet.
 */
function handleToolCallRetryingEvent(
  e: AuraEventOfType<typeof EventType.ToolCallRetrying>,
): void {
  const c = e.content;
  const taskId = c.task_id ?? undefined;
  if (!taskId) return;
  const rawId = typeof c.tool_use_id === "string" ? c.tool_use_id.trim() : "";
  if (!rawId) return;
  const { refs, setters } = contextForTask(taskId);
  handleToolCallRetrying(refs, setters, {
    id: rawId,
    name: (typeof c.tool_name === "string" && c.tool_name) || "unknown",
    attempt: c.attempt,
    max_attempts: c.max_attempts,
    delay_ms: c.delay_ms,
    reason: c.reason ?? "",
  });
}

/**
 * Route a terminal `ToolCallFailed` event into the reducers. Reaching
 * the UI means the harness-side streaming retry budget was exhausted;
 * the server no longer runs a parallel tool-call retry budget. The
 * reducer marks the card red and latches `retryExhausted` so the
 * renderer can surface "retried N/max — <reason>" instead of just
 * "retrying…".
 */
function handleToolCallFailedEvent(
  e: AuraEventOfType<typeof EventType.ToolCallFailed>,
): void {
  const c = e.content;
  const taskId = c.task_id ?? undefined;
  if (!taskId) return;
  const rawId = typeof c.tool_use_id === "string" ? c.tool_use_id.trim() : "";
  if (!rawId) return;
  const { refs, setters } = contextForTask(taskId);
  handleToolCallFailed(refs, setters, {
    id: rawId,
    name: (typeof c.tool_name === "string" && c.tool_name) || "unknown",
    reason: c.reason ?? "",
  });
}

function handleAssistantMessageEndEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const { key, refs, setters } = contextForTask(taskId);
  handleAssistantTurnBoundary(refs, setters);

  // Mirror the chat handler in `use-chat-stream/build-stream-handler.ts`
  // so the task header context pill reconciles to the authoritative
  // harness-reported utilization at each turn boundary. The data has
  // always been on the wire — it was just dropped here previously.
  const usage = c.usage as
    | {
        context_utilization?: number;
        estimated_context_tokens?: number;
        context_breakdown?: WireContextBreakdown;
      }
    | undefined;
  if (usage?.context_utilization != null) {
    useContextUsageStore
      .getState()
      .setContextUtilization(
        key,
        usage.context_utilization,
        usage.estimated_context_tokens,
        mapWireContextBreakdown(usage.context_breakdown),
      );
  }
}

function handleProgressEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const stage = (c.stage as string) ?? "";
  if (!stage) return;
  const { setters } = contextForTask(taskId);
  setters.setProgressText(stage);
}

function handleGitCommittedEvent(e: AuraEventOfType<typeof EventType.GitCommitted>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  const sha = e.content.commit_sha?.slice(0, 7) ?? "";
  handleToolCallStarted(refs, setters, { id, name: "git_commit" });
  handleToolResult(refs, setters, {
    id,
    name: "git_commit",
    result: sha ? `Committed ${sha}` : "Committed",
    is_error: false,
  });
}

function handleGitCommitFailedEvent(
  e: AuraEventOfType<typeof EventType.GitCommitFailed>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  handleToolCallStarted(refs, setters, { id, name: "git_commit" });
  handleToolResult(refs, setters, {
    id,
    name: "git_commit",
    result: e.content.reason ?? "Commit failed",
    is_error: true,
  });
}

function handleGitCommitRolledBackEvent(
  e: AuraEventOfType<typeof EventType.GitCommitRolledBack>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  const sha = e.content.commit_sha?.slice(0, 7) ?? "unknown";
  handleToolCallStarted(refs, setters, { id, name: "git_commit_rolled_back" });
  handleToolResult(refs, setters, {
    id,
    name: "git_commit_rolled_back",
    result: `Rolled back ${sha}: ${e.content.reason ?? "DoD gate rejected commit"}`,
    is_error: true,
  });
}

function handleGitPushedEvent(e: AuraEventOfType<typeof EventType.GitPushed>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  const count = e.content.commits?.length ?? 0;
  const branch = e.content.branch ?? "main";
  handleToolCallStarted(refs, setters, { id, name: "git_push" });
  handleToolResult(refs, setters, {
    id,
    name: "git_push",
    result: `Pushed ${count} commit${count !== 1 ? "s" : ""} to ${branch}`,
    is_error: false,
  });
}

function handleGitPushFailedEvent(
  e: AuraEventOfType<typeof EventType.GitPushFailed>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  handleToolCallStarted(refs, setters, { id, name: "git_push" });
  handleToolResult(refs, setters, {
    id,
    name: "git_push",
    result: e.content.reason ?? "Push failed",
    is_error: true,
  });
}

function mergeBufferedOutput(taskId: string, streamBuffer: string, projectId?: string): void {
  if (!streamBuffer) return;
  const existingText = getTaskOutput(taskId).text;
  const mergedText = existingText.endsWith(streamBuffer)
    ? existingText
    : `${existingText}${streamBuffer}`;
  if (mergedText && mergedText !== existingText) {
    useEventStore
      .getState()
      .seedTaskOutput(taskId, mergedText, undefined, undefined, undefined, projectId);
  }
}

/**
 * Snapshot the finalized events for `taskId` into the persistent turn
 * cache so the Run panel and sidekick overlay can rehydrate a rich
 * post-completion view after the in-memory stream entry is pruned or
 * the page reloads. No-ops when no events have been captured yet.
 */
function snapshotTaskTurns(taskId: string, projectId?: string): void {
  const entry = getStreamEntry(taskStreamKey(taskId));
  if (!entry || entry.events.length === 0) return;
  persistTaskTurns(taskId, entry.events, projectId);
}

function handleTaskCompleted(e: AuraEventOfType<typeof EventType.TaskCompleted>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters, abortRef } = contextForTask(taskId);
  mergeBufferedOutput(taskId, refs.streamBuffer.current, e.project_id);
  // Inject the closing `in_progress -> done` block BEFORE finalize so
  // it lands inside the same assistant turn that finalizeStream snapshots
  // into `events[]` (and therefore survives `snapshotTaskTurns`'s reload
  // rehydration). Adding it after finalize would leak it onto the next
  // turn or be discarded entirely.
  //
  // Wrapped: synthetic block emit is decorative — see the matching
  // try/catch in `handleTaskStarted` for the rationale. The lifecycle
  // calls below (`finalizeStream`, `completeTask`, `setLiveStatus`,
  // `snapshotTaskTurns`) MUST run even if the synthetic emit throws.
  try {
    emitSyntheticTransitionBlock(taskId, {
      fromStatus: "in_progress",
      toStatus: "done",
      title: e.content.task_title,
    });
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("synthetic transition block emit failed; lifecycle continues", err);
    }
  }
  finalizeStream(refs, setters, abortRef, isStreamingByTask.get(taskId) ?? false, {
    reason: "completed",
  });
  isStreamingByTask.delete(taskId);
  useTaskOutputPanelStore.getState().completeTask(taskId);
  useTaskStatusStore.getState().setLiveStatus(taskId, "done");
  snapshotTaskTurns(taskId, e.project_id);
}

function handleTaskFailed(e: AuraEventOfType<typeof EventType.TaskFailed>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters, abortRef } = contextForTask(taskId);
  mergeBufferedOutput(taskId, refs.streamBuffer.current, e.project_id);
  // Mirror the fallback chain in `useTaskStatus`: some synthetic /
  // legacy failure payloads use `error` or `message` instead of the
  // canonical `reason` field. Without these fallbacks the sidekick
  // panel would show a red badge with no explanation.
  const raw = parseEventContent(e);
  const reason =
    (typeof raw.reason === "string" && raw.reason) ||
    (typeof raw.error === "string" && raw.error) ||
    (typeof raw.message === "string" && raw.message) ||
    null;
  // Structured provider context plumbed by the server's
  // `extract_task_failure_context` as sibling fields on the event.
  // Forwarded into the panel store so `CompletedTaskOutput` can
  // render a compact `req=… · model=… · type=…` label under the
  // reason. We also accept the historical `request_id` /
  // `error_type` / `msg_id` aliases so a pre-Commit-D server still
  // round-trips cleanly through a newer UI.
  const pickStr = (k: string): string | undefined =>
    typeof raw[k] === "string" && (raw[k] as string).trim().length > 0
      ? (raw[k] as string).trim()
      : undefined;
  const failureContext = {
    providerRequestId: pickStr("provider_request_id") ?? pickStr("request_id"),
    model: pickStr("model"),
    sseErrorType: pickStr("sse_error_type") ?? pickStr("error_type"),
    messageId: pickStr("message_id") ?? pickStr("msg_id"),
  };
  // Capture the live cooking-indicator label BEFORE finalize resets
  // it. When the task fails before any text_delta / tool result has
  // landed, this hint ("Submitting plan…", "Cooking…") is the only
  // signal the user had of what the loop was doing — without
  // forwarding it through to `finalizeStream`, the synthetic failure
  // event below would lose it on the `setProgressText("")` reset.
  const progressText = getStreamEntry(taskStreamKey(taskId))?.progressText;
  // Closing `in_progress -> failed` block matching the shape used by
  // `handleTaskCompleted`. Emitted before finalize so the synthetic
  // entry is captured in the assistant turn that gets snapshotted,
  // and rendered with `is_error: true` so `TaskBlock` paints the red
  // `inlineError` row carrying the failure reason.
  //
  // Wrapped: synthetic block emit is decorative — see the matching
  // try/catch in `handleTaskStarted` for the rationale. The lifecycle
  // calls below (`finalizeStream`, `failTask`, `setLiveStatus`,
  // `snapshotTaskTurns`) MUST run even if the synthetic emit throws,
  // otherwise a failed task would silently linger as "active" in the
  // Run panel.
  try {
    emitSyntheticTransitionBlock(taskId, {
      fromStatus: "in_progress",
      toStatus: "failed",
      title: e.content.task_title,
      isError: true,
      reason: reason ?? undefined,
    });
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("synthetic transition block emit failed; lifecycle continues", err);
    }
  }
  finalizeStream(refs, setters, abortRef, isStreamingByTask.get(taskId) ?? false, {
    reason: "failed",
    message: reason ?? undefined,
    progressText,
  });
  isStreamingByTask.delete(taskId);
  useTaskOutputPanelStore.getState().failTask(taskId, reason, failureContext);
  // Mirror the status into the per-task status store. A `null`
  // reason intentionally leaves the existing `liveFailReason`
  // untouched (matching the panel store's behaviour) so a synthetic
  // `task_failed` with no reason can't wipe out a real reason an
  // earlier event already recorded.
  const status = useTaskStatusStore.getState();
  status.setLiveStatus(taskId, "failed");
  if (reason) {
    status.setLiveFailReason(taskId, reason);
  }
  snapshotTaskTurns(taskId, e.project_id);
}

/**
 * Append an in-stream error card when the server's Definition-of-Done
 * gate rejects a `task_completed`. Without this, a run whose tool uses
 * all succeeded would silently flip to "failed" with no visible cause.
 *
 * We reuse the existing tool-result machinery so the entry renders with
 * the same red styling as git failure rows - the gate decision sits
 * between the last tool use and the terminal `task_failed` event in the
 * timeline, which is exactly where a user would look for an explanation.
 */
function handleTaskCompletionGateEvent(
  e: AuraEventOfType<typeof EventType.TaskCompletionGate>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  if (e.content.passed) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  const reason =
    (typeof e.content.failure_reason === "string" && e.content.failure_reason) ||
    "Completion-validation gate rejected this task";
  const evidence = [
    `files ${e.content.n_files_changed}`,
    `build ${e.content.n_build_steps}`,
    `test ${e.content.n_test_steps}`,
    `fmt ${e.content.n_format_steps}`,
    `lint ${e.content.n_lint_steps}`,
    e.content.has_rust_change
      ? "rust"
      : e.content.has_source_change
        ? "source"
        : "docs",
  ].join(" · ");
  handleToolCallStarted(refs, setters, { id, name: "completion_gate_rejected" });
  handleToolResult(refs, setters, {
    id,
    name: "completion_gate_rejected",
    result: `${reason}\n${evidence}`,
    is_error: true,
  });
}

/**
 * Synthesise a block for every server-side task field write.
 *
 * Pairs with `broadcast_task_updated` in
 * `apps/aura-os-server/src/handlers/tasks/crud.rs`. Status flips are
 * intentionally suppressed here because the lifecycle handlers
 * (`handleTaskStarted` / `handleTaskCompleted` / `handleTaskFailed`)
 * already inject a `transition_task` block for the same edge using
 * their richer payloads (failure reason, task title). Without this
 * dedupe we'd render two side-by-side "Task Moved" cards for every
 * `task_started` and `task_completed`.
 *
 * Non-status updates flow through as `update_task` blocks whose
 * summary is the comma-joined `changed_fields` list (see
 * `interface/src/components/Block/renderers/TaskBlock.tsx`).
 */
function handleTaskUpdated(e: AuraEventOfType<typeof EventType.TaskUpdated>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const isStatusEdge = !!e.content.status;
  if (isStatusEdge) {
    // The lifecycle subscribers own status-edge blocks; skip the
    // synthetic update_task to avoid duplicate cards.
    return;
  }
  const fields = e.content.changed_fields ?? [];
  if (fields.length === 0) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  handleToolCallStarted(refs, setters, { id, name: "update_task" });
  handleToolCallSnapshot(refs, setters, {
    id,
    name: "update_task",
    input: { task_id: taskId, changed_fields: fields },
  });
  handleToolResult(refs, setters, {
    id,
    name: "update_task",
    result: fields.join(", "),
    is_error: false,
  });
}

/**
 * Resolve stale pending tool-call cards when the dev loop retries a
 * task after a transient infra failure. Without this, every attempt's
 * `tool_use_start` stacks a fresh "Writing code…" card while the
 * previous attempt's card is stuck in the pending state forever —
 * exactly the "it just keeps saying writing code, but doesn't provide
 * any more details" pattern users saw during `Internal server error`
 * retry storms.
 *
 * We mark the old cards as errored with the retry reason so the panel
 * shows a red "Interrupted by upstream error" row, then the new
 * attempt's tool_use_start events continue to land normally and render
 * below it.
 */
function handleTaskRetryingEvent(
  e: AuraEventOfType<typeof EventType.TaskRetrying>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  resolveAbandonedPendingToolCalls(
    refs,
    setters,
    e.content.reason ?? "retrying after upstream error",
  );
}

/**
 * `LoopStopped` / `LoopFinished` arrives keyed to the project (and
 * usually the agent instance) whose loop ended. We must NOT clear or
 * complete rows for *other* projects' live runs — doing so used to
 * silently wipe the Run panel for project B every time the user
 * stopped a loop in project A. Filter the snapshot + completion to
 * the matching scope, and only forget per-task streaming flags for
 * tasks that actually belonged to the ended loop.
 */
function handleLoopEnd(
  e:
    | AuraEventOfType<typeof EventType.LoopStopped>
    | AuraEventOfType<typeof EventType.LoopFinished>,
): void {
  const projectId = e.project_id;
  const agentInstanceId = e.agent_id ?? undefined;
  if (!projectId) {
    // Without a project id we cannot scope safely; bail rather than
    // fall back to the old global wipe.
    return;
  }
  const panel = useTaskOutputPanelStore.getState();
  const activeTasks = panel.tasks.filter(
    (t) =>
      t.status === "active" &&
      t.projectId === projectId &&
      (!agentInstanceId || t.agentInstanceId === agentInstanceId),
  );
  panel.markCompletedForProject(projectId, agentInstanceId);
  for (const task of activeTasks) {
    snapshotTaskTurns(task.taskId, task.projectId);
    isStreamingByTask.delete(task.taskId);
  }
}

const taskStreamSubscriptionGroup = createEventSubscriptionGroup(
  () => useEventStore.getState().subscribe,
  (subscribe) => [
    subscribe(EventType.TaskStarted, handleTaskStarted),
    subscribe(EventType.TextDelta, handleTextDeltaEvent),
    subscribe(EventType.ThinkingDelta, handleThinkingDeltaEvent),
    subscribe(EventType.ToolUseStart, handleToolUseStartEvent),
    subscribe(EventType.ToolCallSnapshot, handleToolCallSnapshotEvent),
    subscribe(EventType.ToolResult, handleToolResultEvent),
    subscribe(EventType.ToolCallRetrying, handleToolCallRetryingEvent),
    subscribe(EventType.ToolCallFailed, handleToolCallFailedEvent),
    subscribe(EventType.AssistantMessageEnd, handleAssistantMessageEndEvent),
    subscribe(EventType.Progress, handleProgressEvent),
    subscribe(EventType.GitCommitted, handleGitCommittedEvent),
    subscribe(EventType.GitCommitFailed, handleGitCommitFailedEvent),
    subscribe(EventType.GitCommitRolledBack, handleGitCommitRolledBackEvent),
    subscribe(EventType.GitPushed, handleGitPushedEvent),
    subscribe(EventType.GitPushFailed, handleGitPushFailedEvent),
    subscribe(EventType.TaskCompleted, handleTaskCompleted),
    subscribe(EventType.TaskCompletionGate, handleTaskCompletionGateEvent),
    subscribe(EventType.TaskRetrying, handleTaskRetryingEvent),
    subscribe(EventType.TaskFailed, handleTaskFailed),
    subscribe(EventType.TaskUpdated, handleTaskUpdated),
    subscribe(EventType.LoopStopped, handleLoopEnd),
    subscribe(EventType.LoopFinished, handleLoopEnd),
  ],
  () => {
    isStreamingByTask.clear();
  },
);

/**
 * Installs the app-scoped task stream subscriptions. Safe to call
 * multiple times — re-invocations no-op until `teardownTaskStreamBootstrap`
 * is used (test-only).
 */
export function bootstrapTaskStreamSubscriptions(): void {
  taskStreamSubscriptionGroup.bootstrap();
}

/** Test-only: undo the bootstrap so tests can re-install a fresh set. */
export function teardownTaskStreamBootstrap(): void {
  taskStreamSubscriptionGroup.teardown();
}

export function peekIsTaskStreaming(taskId: string): boolean {
  return isStreamingByTask.get(taskId) ?? false;
}
