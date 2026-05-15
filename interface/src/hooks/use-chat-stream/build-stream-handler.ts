import React from "react";
import { api } from "../../api/client";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { useAutomationLoopStore } from "../../stores/automation-loop-store";
import type { ProjectId } from "../../shared/types";
import type { StreamEventHandler } from "../../api/streams";
import type { AuraEvent } from "../../shared/types/aura-events";
import { EventType } from "../../shared/types/aura-events";

import {
  useStreamCore,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall as coreHandleToolCall,
  handleToolResult as coreHandleToolResult,
  handleEventSaved,
  handleAssistantTurnBoundary,
  handleStreamError,
  finalizeStream,
  getThinkingDurationMs,
  isStreamDroppedError,
} from "../use-stream-core";
import type { StreamCloseContext } from "../../shared/observability/stream-breadcrumbs";

import {
  pushPendingSpec,
  pushPendingTask,
  removePendingArtifact,
  promotePendingSpec,
  promotePendingTask,
  backfillToolCallInput,
  isTaskBackfillTool,
  clearAllPendingArtifacts,
  dropPendingByTitle,
} from "./optimistic-artifacts";
import {
  useContextUsageStore,
  approxTokensFromText,
  mapWireContextBreakdown,
  type WireContextBreakdown,
} from "../../stores/context-usage-store";
import { useSessionsListStore } from "../../stores/sessions-list-store";
import { markStreamProgress } from "../stream/store";

export interface DispatchDeps {
  projectId: string;
  agentInstanceId: string | undefined;
  selectedModel?: string | null;
  refs: ReturnType<typeof useStreamCore>["refs"];
  setters: ReturnType<typeof useStreamCore>["setters"];
  abortRef: ReturnType<typeof useStreamCore>["abortRef"];
  coreKey: string;
  setProgressText: (t: string) => void;
  sidekickRef: React.MutableRefObject<ReturnType<typeof useSidekickStore.getState>>;
  projectCtxRef: React.MutableRefObject<ReturnType<typeof useProjectActions>>;
  pendingSpecIdsRef: React.MutableRefObject<string[]>;
  pendingTaskIdsRef: React.MutableRefObject<string[]>;
  /**
   * Invoked once per `SessionReady` SSE event with the server-assigned
   * session id. The chat panel writes `?session=<id>` into the URL so
   * the panel scopes its visible transcript to this session and the
   * next send forwards `session_id` to keep the harness pinned.
   * Replaces the legacy `useLiveSessionStore.pin(...)` machinery.
   */
  onSessionReady?: (sessionId: string) => void;
  /**
   * Notifies the chat hook that the assistant turn completed cleanly
   * (received `AssistantMessageEnd` with a non-tool_use stop reason).
   * The hook uses this to reset the Phase 2 auto-retry counter so a
   * later transient WS drop again gets the full retry budget.
   */
  onAssistantTurnCompleted?: () => void;
  /**
   * Last-chance hook for the chat-stream hook to swallow an error and
   * silently retry the last user message instead of surfacing a hard
   * "*Error*" bubble. Invoked from the handler's `onError` and on any
   * `EventType.Error` whose payload classifies as `streamDropped`.
   * Returning `true` means the hook has taken ownership of the error
   * (e.g. scheduled a retry + shown a "Reconnecting…" banner); the
   * handler then skips its usual `handleStreamError` + pending-artifact
   * cleanup.
   */
  onMaybeAutoRetry?: (error: unknown) => boolean;
  /**
   * Phase 5 breadcrumb context. Forwarded to every `handleStreamError`
   * / `finalizeStream` call inside the handler so the persisted
   * breadcrumb ring carries the originating stream key + agent +
   * session ids. Optional because `useProcessNodeStream` and the
   * task-stream bootstrap reuse the lifecycle handlers without a
   * stream-key context (their breadcrumbs land context-less, which
   * is fine — the support workflow targets chat surfaces only).
   */
  breadcrumbContext?: StreamCloseContext;
}

interface SessionReadyPayload {
  session_id?: string;
}

/** Mirrors the play button (POST /loop/*). Server is authoritative; avoid extra start calls when status already shows a loop.
 *
 * Loop control here always targets the project's `Loop`-role agent
 * instance, NOT the chat surface's `agentInstanceId`. Sending the
 * chat instance id would either collide with the in-flight chat turn
 * (harness "one in-flight turn per agent_id" rule) or — worse — turn
 * the chat thread into a loop runner. We omit the id on start so the
 * backend resolves / creates the canonical loop instance, capture it
 * in the shared store, and use the bound id for pause / resume / stop.
 */
async function bridgeLoopToolResult(
  name: string,
  isError: boolean,
  projectId: string,
  selectedModel: string | null | undefined,
) {
  if (isError) return;
  const loopStore = useAutomationLoopStore.getState();
  const boundLoopId = loopStore.loopByProject[projectId] ?? null;
  switch (name) {
    case "start_dev_loop": {
      try {
        const status = await api.getLoopStatus(projectId);
        if ((status.active_agent_instances?.length ?? 0) > 0) {
          if (status.paused) await api.resumeLoop(projectId, boundLoopId ?? undefined);
          return;
        }
        const res = await api.startLoop(projectId, undefined, selectedModel);
        if (res.agent_instance_id) {
          useAutomationLoopStore
            .getState()
            .setLoopAgent(projectId as ProjectId, res.agent_instance_id);
        }
      } catch {
        /* ignore; automation bar / WS will reflect server state */
      }
      break;
    }
    case "pause_dev_loop":
      api.pauseLoop(projectId, boundLoopId ?? undefined).catch(() => {});
      break;
    case "stop_dev_loop":
      api.stopLoop(projectId, boundLoopId ?? undefined).catch(() => {});
      break;
    case "resume_dev_loop":
      api.resumeLoop(projectId, boundLoopId ?? undefined).catch(() => {});
      break;
  }
}

export function buildStreamHandler(deps: DispatchDeps): StreamEventHandler {
  const {
    projectId, agentInstanceId, selectedModel, refs, setters, abortRef, coreKey,
    setProgressText, sidekickRef, projectCtxRef,
    pendingSpecIdsRef, pendingTaskIdsRef, onSessionReady,
    onAssistantTurnCompleted, onMaybeAutoRetry, breadcrumbContext,
  } = deps;
  // Track the last session id we forwarded to `onSessionReady` so a
  // chatty stream that re-emits `SessionReady` (e.g. mid-stream
  // recovery) doesn't repeatedly bounce the URL through the same
  // value and trigger a feedback loop with the panel-level effect
  // that pins `useChatStream({ sessionId })`.
  let lastNotifiedSessionId: string | null = null;

  const onEvent = (event: AuraEvent) => {
    switch (event.type) {
      case EventType.Delta:
      case EventType.TextDelta: {
        const text = (event.content as { text: string }).text;
        handleTextDelta(refs, setters, getThinkingDurationMs(coreKey), text);
        useContextUsageStore
          .getState()
          .bumpEstimatedTokens(coreKey, approxTokensFromText(text));
        break;
      }
      case EventType.ThinkingDelta: {
        const tc = event.content as { text?: string; thinking?: string };
        const text = tc.text ?? tc.thinking ?? "";
        handleThinkingDelta(refs, setters, text);
        useContextUsageStore
          .getState()
          .bumpEstimatedTokens(coreKey, approxTokensFromText(text));
        break;
      }
      case EventType.Progress: {
        const stage = event.content.stage;
        if (stage === "lagged") {
          setProgressText("Catching up on stream output…");
        } else if (stage === "forked_for_context") {
          // Phase 3 auto-fork: the server transparently rolled this
          // chat over to a fresh storage session because the prior
          // one's `context_utilization` crossed
          // `AURA_CHAT_AUTO_FORK_THRESHOLD`. The payload carries
          // `previous_session_id` + `new_session_id`; we surface a
          // one-shot soft banner, swap `?session=` to the new id via
          // `onSessionReady`, and bump the sessions list so the
          // sidekick reorders the row to the top. Treated as a
          // generic Progress payload here (the server emits it as
          // `EventType.Progress` with `stage="forked_for_context"`)
          // so the protocol stays backwards-compatible with older
          // clients that ignore unknown stages.
          const fork = event.content as {
            stage: string;
            previous_session_id?: string;
            new_session_id?: string;
            message?: string;
          };
          setProgressText(
            fork.message ?? "Continued from previous chat — context was filling up",
          );
          if (fork.new_session_id && fork.new_session_id !== lastNotifiedSessionId) {
            lastNotifiedSessionId = fork.new_session_id;
            onSessionReady?.(fork.new_session_id);
            useSessionsListStore.getState().bumpVersion();
          }
        } else {
          setProgressText(stage);
        }
        break;
      }
      case EventType.ToolCallStarted:
      case EventType.ToolUseStart: {
        const tcs = event.content as { id: string; name: string };
        handleToolCallStarted(refs, setters, tcs);
        // Surface optimistic spec/task placeholders the moment the tool
        // actually starts running so the sidekick doesn't sit empty for
        // the duration of the tool call.
        if (tcs.name === "create_spec") {
          pushPendingSpec({ id: tcs.id, name: tcs.name }, projectId, sidekickRef.current, pendingSpecIdsRef);
        } else if (tcs.name === "create_task") {
          pushPendingTask({ id: tcs.id, name: tcs.name }, projectId, sidekickRef.current, pendingTaskIdsRef);
        }
        break;
      }
      case EventType.ToolCallSnapshot: {
        const snap = event.content;
        handleToolCallSnapshot(refs, setters, snap);
        // Update the optimistic placeholder title as the model streams
        // arguments (`title`, `spec_id`, `description`, ...). pushSpec /
        // pushTask upsert by id, so re-calling here is safe.
        if (snap.name === "create_spec") {
          pushPendingSpec(snap, projectId, sidekickRef.current, pendingSpecIdsRef);
        } else if (snap.name === "create_task") {
          pushPendingTask(snap, projectId, sidekickRef.current, pendingTaskIdsRef);
        }
        break;
      }
      case EventType.ToolCall: {
        const c = event.content;
        coreHandleToolCall(refs, setters, c);
        // `ToolCall` is the finalized args payload; if we missed the
        // earlier start/snapshot events (e.g. network gap), still seed a
        // placeholder here. pushPendingSpec/Task are idempotent by id.
        if (c.name === "create_spec") pushPendingSpec(c, projectId, sidekickRef.current, pendingSpecIdsRef);
        if (c.name === "create_task") pushPendingTask(c, projectId, sidekickRef.current, pendingTaskIdsRef);
        break;
      }
      case EventType.ToolResult: {
        const c = event.content as { id: string; name: string; result: string; is_error: boolean };
        coreHandleToolResult(refs, setters, c);
        // Tool results count against the context window; approximate
        // from the result body so the Context pill moves immediately
        // rather than only after the next AssistantMessageEnd.
        if (typeof c.result === "string" && c.result.length > 0) {
          useContextUsageStore
            .getState()
            .bumpEstimatedTokens(coreKey, approxTokensFromText(c.result));
        }
        void bridgeLoopToolResult(c.name, c.is_error, projectId, selectedModel);
        if (c.name === "create_spec") {
          if (c.is_error) removePendingArtifact(c.id, pendingSpecIdsRef, (id) => sidekickRef.current.removeSpec(id));
          else promotePendingSpec(c, projectId, sidekickRef.current, pendingSpecIdsRef);
        }
        if (c.name === "create_task") {
          if (c.is_error) removePendingArtifact(c.id, pendingTaskIdsRef, (id) => sidekickRef.current.removeTask(id));
          else {
            promotePendingTask(c, projectId, sidekickRef.current, pendingTaskIdsRef);
          }
        }
        if (!c.is_error && isTaskBackfillTool(c.name)) {
          backfillToolCallInput(refs, setters, event.content as Record<string, unknown>);
        }
        if (c.name === "delete_spec" && !c.is_error) {
          try {
            const parsed = JSON.parse(c.result) as { deleted?: string };
            if (typeof parsed?.deleted === "string") sidekickRef.current.removeSpec(parsed.deleted);
          } catch { /* ignore */ }
        }
        break;
      }
      case EventType.SpecSaved: {
        const spec = event.content.spec;
        // Match by title rather than FIFO-shifting so concurrent specs
        // in flight (or engine-channel SpecSaveds arriving out of order)
        // don't evict an unrelated placeholder.
        dropPendingByTitle(
          pendingSpecIdsRef,
          spec.title,
          (id) =>
            (sidekickRef.current.specs ?? []).find((s) => s.spec_id === id)?.title,
          (id) => sidekickRef.current.removeSpec(id),
        );
        sidekickRef.current.pushSpec(spec);
        break;
      }
      case EventType.SpecsTitle: {
        const pctx = projectCtxRef.current;
        if (pctx) pctx.setProject((prev) => ({ ...prev, specs_title: event.content.title }));
        break;
      }
      case EventType.SpecsSummary: {
        const pctx = projectCtxRef.current;
        if (pctx) pctx.setProject((prev) => ({ ...prev, specs_summary: event.content.summary }));
        break;
      }
      case EventType.TaskSaved: {
        const task = event.content.task;
        dropPendingByTitle(
          pendingTaskIdsRef,
          task.title,
          (id) =>
            (sidekickRef.current.tasks ?? []).find((t) => t.task_id === id)?.title,
          (id) => sidekickRef.current.removeTask(id),
        );
        sidekickRef.current.pushTask(task);
        break;
      }
      case EventType.MessageEnd:
        handleEventSaved(refs, setters, event.content.event);
        break;
      case EventType.AssistantMessageEnd: {
        handleAssistantTurnBoundary(refs, setters);
        const amc = event.content as {
          stop_reason?: string;
          usage?: {
            context_utilization?: number;
            estimated_context_tokens?: number;
            // Optional because older harness builds omit it; the store
            // treats an undefined or all-zero breakdown as "fall back
            // to the legacy used/total view".
            context_breakdown?: WireContextBreakdown;
          };
        };
        if (amc.usage?.context_utilization != null) {
          useContextUsageStore
            .getState()
            .setContextUtilization(
              coreKey,
              amc.usage.context_utilization,
              amc.usage.estimated_context_tokens,
              mapWireContextBreakdown(amc.usage.context_breakdown),
            );
        }
        if (amc.stop_reason !== "tool_use") {
          resetStreamBuffers(refs, setters);
          setters.setIsStreaming(false);
          if (agentInstanceId) {
            sidekickRef.current.setAgentStreaming(agentInstanceId, false);
          }
          // Phase 2: the assistant finished a turn cleanly, so the
          // auto-retry budget should reset for any future transient WS
          // drop on the NEXT user message.
          onAssistantTurnCompleted?.();
        }
        break;
      }
      case EventType.AgentInstanceUpdated:
        sidekickRef.current.notifyAgentInstanceUpdate(event.content.agent_instance);
        break;
      case EventType.AssistantMessageStart:
        break;
      case EventType.SessionReady: {
        // Capture the server-assigned session id whenever a
        // `SessionReady` arrives. The chat panel passes
        // `onSessionReady` so it can write `?session=<id>` into the
        // URL — making the URL the single source of truth for which
        // session this view extends. We also bump
        // `useSessionsListStore.version` so the sidekick "Chats" tab
        // refreshes the row order (a brand-new session jumps to the
        // top).
        const payload = event.content as SessionReadyPayload;
        const newSessionId = payload?.session_id;
        if (newSessionId && newSessionId !== lastNotifiedSessionId) {
          lastNotifiedSessionId = newSessionId;
          onSessionReady?.(newSessionId);
          const sessionsStore = useSessionsListStore.getState();
          sessionsStore.bumpVersion();
        }
        break;
      }
      case EventType.TokenUsage:
        break;
      case EventType.GenerationStart:
        setProgressText(
          event.content.mode === "image" ? "Generating image..." :
          event.content.mode === "video" ? "Generating video..." :
          "Generating 3D model...",
        );
        break;
      case EventType.GenerationProgress:
        setProgressText(event.content.message || `${event.content.percent}%`);
        break;
      case EventType.GenerationPartialImage:
        // Partial-image frames carry no text we want to render, but they
        // ARE wire activity. Without this ack the 60s stuck-stream
        // watchdog (`useStuckStreamAutoTimeout`) auto-aborts long
        // partial-image renders like `gpt-image-2` whose `progress`
        // events are sparser than the 60s window.
        markStreamProgress(coreKey);
        break;
      case EventType.GenerationCompleted: {
        const gc = event.content;
        const toolName =
          gc.mode === "3d" ? "generate_3d_model" :
          gc.mode === "video" ? "generate_video" :
          "generate_image";
        const toolId = `gen-${Date.now()}`;
        coreHandleToolCall(refs, setters, { id: toolId, name: toolName, input: {} });
        coreHandleToolResult(refs, setters, { id: toolId, name: toolName, result: JSON.stringify(gc), is_error: false });
        finalizeStream(refs, setters, abortRef, false, { reason: "completed", breadcrumbContext });
        if (agentInstanceId) {
          sidekickRef.current.setAgentStreaming(agentInstanceId, false);
        }
        break;
      }
      case EventType.GenerationError:
        handleStreamError(refs, setters, event.content, breadcrumbContext);
        break;
      case EventType.Error: {
        // Phase 2: a transient WS-side `Error` payload (`harness_ws_closed`,
        // `harness_ws_read_error`, `harness_protocol_mismatch`,
        // `stream_lagged`, ...) classifies as `streamDropped`. Give the
        // hook a chance to silently auto-retry the last user message
        // instead of showing a hard error bubble.
        if (
          isStreamDroppedError(event.content) &&
          onMaybeAutoRetry?.(event.content)
        ) {
          break;
        }
        handleStreamError(refs, setters, event.content, breadcrumbContext);
        break;
      }
      case EventType.Done:
        finalizeStream(refs, setters, abortRef, false, { breadcrumbContext });
        if (agentInstanceId) {
          sidekickRef.current.setAgentStreaming(agentInstanceId, false);
        }
        clearAllPendingArtifacts(pendingSpecIdsRef, (id) =>
          sidekickRef.current.removeSpec(id),
        );
        clearAllPendingArtifacts(pendingTaskIdsRef, (id) =>
          sidekickRef.current.removeTask(id),
        );
        break;
    }
  };

  return {
    onEvent,
    onError: (error) => {
      // Phase 2: streamDropped errors (SSE idle, harness WS close,
      // stream_lagged, ...) get a chance at silent auto-retry before
      // we surface a hard error and clear optimistic artifacts. The
      // hook returning `true` means it has scheduled a retry and
      // taken ownership of the user-visible state.
      if (isStreamDroppedError(error) && onMaybeAutoRetry?.(error)) {
        return;
      }
      handleStreamError(refs, setters, error, breadcrumbContext);
      if (agentInstanceId) {
        sidekickRef.current.setAgentStreaming(agentInstanceId, false);
      }
      clearAllPendingArtifacts(pendingSpecIdsRef, (id) =>
        sidekickRef.current.removeSpec(id),
      );
      clearAllPendingArtifacts(pendingTaskIdsRef, (id) =>
        sidekickRef.current.removeTask(id),
      );
    },
    onDone: () => {
      finalizeStream(refs, setters, abortRef, false, { breadcrumbContext });
      if (agentInstanceId) {
        sidekickRef.current.setAgentStreaming(agentInstanceId, false);
      }
      clearAllPendingArtifacts(pendingSpecIdsRef, (id) =>
        sidekickRef.current.removeSpec(id),
      );
      clearAllPendingArtifacts(pendingTaskIdsRef, (id) =>
        sidekickRef.current.removeTask(id),
      );
    },
  };
}
