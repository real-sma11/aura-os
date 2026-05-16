import { useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { generate3dStream, generateImageStream, generateVideoStream } from "../api/streams";
import type { ChatAttachment, StreamEventHandler } from "../api/streams";
import { DEFAULT_IMAGE_MODEL_ID, type GenerationMode } from "../constants/models";
import { STYLE_LOCK_SUFFIX } from "../constants/generation";
import { buildUserChatMessage } from "./attachment-helpers";
import type { Spec, Task } from "../shared/types";
import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import { useChatUIStore } from "../stores/chat-ui-store";
import {
  useStreamCore,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall,
  handleToolResult,
  handleEventSaved,
  handleAssistantTurnBoundary,
  handleStreamError,
  finalizeStream,
  getIsStreaming,
  getThinkingDurationMs,
} from "./use-stream-core";
import type { DisplaySessionEvent } from "../shared/types/stream";
import {
  useContextUsageStore,
  approxTokensFromText,
  mapWireContextBreakdown,
  type WireContextBreakdown,
} from "../stores/context-usage-store";
import { useSessionsListStore } from "../stores/sessions-list-store";
import { useMessageQueueStore } from "../stores/message-queue-store";
import { getLastEventAt, getStreamEntry, markStreamProgress } from "./stream/store";
import { STUCK_THRESHOLD_MS } from "./stream/use-stream-health";
import type { StreamCloseContext } from "../shared/observability/stream-breadcrumbs";

/**
 * Per-streamKey cache of the most recent `sendMessage` payload plus
 * the live hook callable. Mirrors the `partition-send-control`
 * pattern in `use-chat-stream/partition-send-control.ts`: the
 * project-chat branch already captures auto-retry args there, but
 * `useAgentChatStream` doesn't go through that map. Phase 2's
 * stuck-stream retry needs a uniform replay surface for both
 * branches, so we add an analogous Map here keyed by `streamKey`.
 *
 * `sendFn` is registered by every active hook instance via `useEffect`
 * so {@link replayLastSend} can re-fire the cached args without
 * dragging the hook return through the retry callback chain.
 */
interface AgentChatStreamReplayEntry {
  lastSendArgs: AgentChatLastSendArgs | null;
  sendFn: ((args: AgentChatLastSendArgs) => Promise<void>) | null;
}

export interface AgentChatLastSendArgs {
  content: string;
  action: string | null;
  selectedModel?: string | null;
  attachments?: ChatAttachment[];
  commands?: string[];
  projectId?: string;
  generationMode?: GenerationMode;
  sourceImageUrl?: string;
}

const agentChatStreamReplayMap = new Map<string, AgentChatStreamReplayEntry>();

function getOrCreateReplayEntry(key: string): AgentChatStreamReplayEntry {
  let entry = agentChatStreamReplayMap.get(key);
  if (!entry) {
    entry = { lastSendArgs: null, sendFn: null };
    agentChatStreamReplayMap.set(key, entry);
  }
  return entry;
}

/**
 * Last captured `sendMessage` payload for the given stream, or `null`
 * if no send has occurred (or the entry was cleared). Phase 2's
 * stuck-stream pill consults this through ChatPanel's `handleRetry`
 * to decide whether a retry is even possible.
 */
export function getLastSendArgs(streamKey: string): AgentChatLastSendArgs | null {
  return agentChatStreamReplayMap.get(streamKey)?.lastSendArgs ?? null;
}

/**
 * Re-fire the most recent `sendMessage` for `streamKey` against the
 * currently mounted hook. No-op if no send has been captured yet or
 * no hook is registered for the key. Returns a `Promise<void>` so
 * callers can `await` without branching.
 *
 * Caller is responsible for halting the stuck stream first
 * (`baseStopStreaming` / `onStop`) so the in-flight latch unwinds
 * before the replay tries to re-enter.
 */
export async function replayLastSend(streamKey: string): Promise<void> {
  const entry = agentChatStreamReplayMap.get(streamKey);
  if (!entry?.lastSendArgs || !entry.sendFn) return;
  await entry.sendFn(entry.lastSendArgs);
}

/** Test-only reset for vitest `beforeEach` setup. */
export function _resetAgentChatStreamReplayMap(): void {
  agentChatStreamReplayMap.clear();
}

interface UseAgentChatStreamOptions {
  agentId: string | undefined;
  onTaskSaved?: (task: Task) => void;
  onSpecSaved?: (spec: Spec) => void;
  /**
   * Pin sends to a specific historical session id. See the matching
   * field on `useChatStream`'s options.
   */
  sessionId?: string | null;
  /**
   * Called once per `SessionReady` whenever the server-assigned session
   * id changes. The chat panel uses this to mirror the new id into
   * `?session=<id>` (replace navigation), making the URL the single
   * source of truth for which session is being extended.
   */
  onSessionReady?: (sessionId: string) => void;
}

interface UseAgentChatStreamResult {
  streamKey: string;
  sendMessage: (
    content: string,
    action?: string | null,
    selectedModel?: string | null,
    attachments?: ChatAttachment[],
    commands?: string[],
    projectId?: string,
    generationMode?: GenerationMode,
    sourceImageUrl?: string,
  ) => Promise<void>;
  stopStreaming: () => void;
  resetEvents: (msgs: DisplaySessionEvent[], options?: { allowWhileStreaming?: boolean }) => void;
  markNextSendAsNewSession: () => void;
}

export function useAgentChatStream({
  agentId,
  onTaskSaved,
  onSpecSaved,
  sessionId,
  onSessionReady,
}: UseAgentChatStreamOptions): UseAgentChatStreamResult {
  const core = useStreamCore([agentId]);
  const { refs, setters, abortRef } = core;
  const nextSendStartsNewSessionRef = useRef(false);
  const sessionIdRef = useRef(sessionId ?? null);
  useEffect(() => {
    sessionIdRef.current = sessionId ?? null;
    // Symmetric clear with `use-chat-stream.ts`: when the user
    // presses "+" (sets the pin and drops `?session=`) and then
    // navigates back to a real session row before sending, treat
    // that as an explicit "extend THIS session" intent and drop the
    // pin so the next send doesn't force a brand-new session id.
    if (sessionId) nextSendStartsNewSessionRef.current = false;
  }, [sessionId]);
  // Reset the pin whenever the underlying stream partition changes
  // (agent swap inside the chat-app shell). The ref isn't keyed by
  // `core.key` the way `partition-send-control` is in
  // `use-chat-stream.ts`, so a "+" press on agent A would otherwise
  // bleed forward into agent B's first send and force an unwanted
  // new session there.
  useEffect(() => {
    nextSendStartsNewSessionRef.current = false;
  }, [core.key]);
  const onSessionReadyRef = useRef(onSessionReady);
  useEffect(() => { onSessionReadyRef.current = onSessionReady; }, [onSessionReady]);
  // Track the last id we pushed to `onSessionReady` so a re-emission
  // from the server doesn't ping the URL repeatedly. Mirror of the
  // same guard in `build-stream-handler.ts`.
  const lastNotifiedSessionIdRef = useRef<string | null>(null);
  // Synchronous latch covering the gap between a `sendMessage` invocation
  // and the moment `setIsStreaming(true)` propagates through Zustand. The
  // existing `getIsStreaming(core.key)` check reads through Zustand and is
  // racy when two clicks (or a click + queue-dequeue replay) land in the
  // same microtask: both reads see `false`, both writes proceed, and the
  // CEO's first chat ends up issuing two POSTs. The ref flips synchronously
  // before any await so the second caller short-circuits cleanly.
  const inFlightRef = useRef(false);

  const onSpecSavedRef = useRef(onSpecSaved);
  useEffect(() => { onSpecSavedRef.current = onSpecSaved; }, [onSpecSaved]);

  const onTaskSavedRef = useRef(onTaskSaved);
  useEffect(() => { onTaskSavedRef.current = onTaskSaved; }, [onTaskSaved]);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      selectedModel?: string | null,
      attachments?: ChatAttachment[],
      commands?: string[],
      projectId?: string,
      _generationMode?: GenerationMode,
      _sourceImageUrl?: string,
    ) => {
      if (!agentId || inFlightRef.current) return;
      const trimmed = content.trim();
      const hasAttachments = attachments && attachments.length > 0;
      // 3D model step (`generationMode === "3d"` with a pinned source image)
      // dispatches without text or attachments — the source image is the
      // payload — so let it through the empty-content guard.
      const is3DModelStep =
        _generationMode === "3d" && typeof _sourceImageUrl === "string" && _sourceImageUrl.length > 0;
      if (!trimmed && !action && !hasAttachments && !is3DModelStep) return;

      // Phase 2 stuck-stream retry: capture the payload before any
      // queue/in-flight branching so the most recent user-intended
      // send is always replayable. Mirrors `lastSendArgs` capture in
      // `use-chat-stream`'s `performSend`.
      getOrCreateReplayEntry(core.key).lastSendArgs = {
        content,
        action,
        selectedModel,
        attachments,
        commands,
        projectId,
        generationMode: _generationMode,
        sourceImageUrl: _sourceImageUrl,
      };

      // A turn is already in flight on this key. Instead of silently
      // dropping the typed message (the original behavior, which made
      // the chat feel broken), enqueue into the per-stream queue so
      // the existing `useChatPanelState` dequeue effect re-fires it
      // when the current turn finalizes. If the in-flight turn has
      // gone past `STUCK_THRESHOLD_MS` without a wire event, mark the
      // entry with `pendingDueToStuckStream` so a Phase 2 banner can
      // offer "Send anyway" — Phase 1 just preserves the message.
      if (getIsStreaming(core.key)) {
        const lastEventAt = getLastEventAt(core.key);
        const isStuck =
          lastEventAt != null && Date.now() - lastEventAt >= STUCK_THRESHOLD_MS;
        useMessageQueueStore.getState().enqueue(core.key, {
          content,
          action,
          model: selectedModel ?? null,
          attachments,
          commands,
          generationMode: _generationMode,
          sourceImageUrl: _sourceImageUrl,
          pendingDueToStuckStream: isStuck,
        });
        return;
      }

      inFlightRef.current = true;

      const userMsg = buildUserChatMessage(
        trimmed,
        attachments,
        is3DModelStep ? "Generate 3D model" : undefined,
      );

      core.setEvents((prev) => [...prev, userMsg]);
      core.setIsStreaming(true);
      resetStreamBuffers(refs, setters);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Phase 5: snapshot the breadcrumb context for this turn so
      // every error / finalize path inside the handler stamps the
      // persisted ring entry with the originating stream key +
      // agent + session ids.
      const breadcrumbContext: StreamCloseContext = {
        streamKey: core.key,
        agentId,
        sessionId: sessionIdRef.current ?? undefined,
      };

      const handler: StreamEventHandler = {
        onEvent(event: AuraEvent) {
          // Buffered SSE frames can still land in this handler closure
          // after the controller was aborted (browsers don't flush the
          // reader's internal queue synchronously with `abort()`). If a
          // "Send now" force-send has already taken over the partition,
          // letting those stale events through would clobber the new
          // turn's `isStreaming`/`inFlightRef`/`streamBuffer` state
          // — the symptom the user reported as "stop doesn't stop the
          // old turn and the new one doesn't render correctly". Bail
          // out early so the new turn owns the partition uncontested.
          if (controller.signal.aborted) return;
          switch (event.type) {
            case EventType.Delta:
            case EventType.TextDelta: {
              const text = (event.content as { text: string }).text;
              handleTextDelta(refs, setters, getThinkingDurationMs(core.key), text);
              useContextUsageStore
                .getState()
                .bumpEstimatedTokens(core.key, approxTokensFromText(text));
              break;
            }
            case EventType.ThinkingDelta: {
              const tc = event.content as { text?: string; thinking?: string };
              const text = tc.text ?? tc.thinking ?? "";
              handleThinkingDelta(refs, setters, text);
              useContextUsageStore
                .getState()
                .bumpEstimatedTokens(core.key, approxTokensFromText(text));
              break;
            }
            case EventType.Progress: {
              const stage = event.content.stage;
              if (stage === "heartbeat") {
                // Pure stuck-stream-watchdog ack from the server-side
                // SSE heartbeat (`SSE_HEARTBEAT_INTERVAL` in
                // `apps/aura-os-server/src/handlers/agents/chat/streaming.rs`).
                // Bumps `lastEventAt` so a healthy but quiet plan-mode
                // turn (model thinking after a batch of `ToolResult`
                // events) doesn't trip `useStuckStreamAutoTimeout` —
                // but must NOT call `setProgressText`, which would
                // render the literal "heartbeat" string in the
                // streaming indicator (`getStreamingPhaseLabel`
                // renders unknown stages verbatim).
                markStreamProgress(core.key);
                break;
              }
              core.setProgressText(stage);
              break;
            }
            case EventType.ToolCallStarted:
            case EventType.ToolUseStart:
              handleToolCallStarted(refs, setters, event.content as { id: string; name: string });
              break;
            case EventType.ToolCallSnapshot:
              handleToolCallSnapshot(refs, setters, event.content);
              break;
            case EventType.ToolCall:
              handleToolCall(refs, setters, event.content);
              break;
            case EventType.ToolResult: {
              const tr = event.content as { id: string; name: string; result: string; is_error: boolean };
              handleToolResult(refs, setters, tr);
              if (typeof tr.result === "string" && tr.result.length > 0) {
                useContextUsageStore
                  .getState()
                  .bumpEstimatedTokens(core.key, approxTokensFromText(tr.result));
              }
              break;
            }
            case EventType.SpecSaved:
              onSpecSavedRef.current?.(event.content.spec);
              break;
            case EventType.TaskSaved:
              onTaskSavedRef.current?.(event.content.task);
              break;
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
                  // Optional because older harness builds omit it; the
                  // store treats an undefined or all-zero breakdown as
                  // "fall back to the legacy used/total view".
                  context_breakdown?: WireContextBreakdown;
                };
              };
              if (amc.usage?.context_utilization != null) {
                useContextUsageStore
                  .getState()
                  .setContextUtilization(
                    core.key,
                    amc.usage.context_utilization,
                    amc.usage.estimated_context_tokens,
                    mapWireContextBreakdown(amc.usage.context_breakdown),
                  );
              }
              if (amc.stop_reason !== "tool_use") {
                resetStreamBuffers(refs, setters);
                // Clear the synchronous re-entry latch in lockstep with
                // `isStreaming` so the `useChatPanelState` dequeue effect,
                // which fires on the `true -> false` transition, can
                // re-enter `sendMessage` without being silently swallowed
                // by the in-flight guard at the top of this function.
                // Without this sync the outer async fn's `finally` only
                // resets the latch after the SSE has fully closed, which
                // races with the dequeue and drops queued prompts.
                inFlightRef.current = false;
                core.setIsStreaming(false);
              }
              break;
            }
            case EventType.AssistantMessageStart:
            case EventType.TokenUsage:
              break;
            case EventType.SessionReady: {
              // See `build-stream-handler.ts` for the project-side
              // counterpart. The chat panel passes `onSessionReady`
              // so the URL can switch to `?session=<id>` once the
              // server assigns one — making the URL the single
              // source of truth for the session the user is
              // extending.
              const payload = event.content as { session_id?: string };
              const newSessionId = payload?.session_id;
              if (newSessionId && newSessionId !== lastNotifiedSessionIdRef.current) {
                lastNotifiedSessionIdRef.current = newSessionId;
                onSessionReadyRef.current?.(newSessionId);
                const sessionsStore = useSessionsListStore.getState();
                sessionsStore.bumpVersion();
              }
              break;
            }
            case EventType.GenerationStart: {
              const mode = event.content.mode;
              core.setProgressText(
                mode === "image" ? "Generating image..." :
                mode === "video" ? "Generating video..." :
                "Generating 3D model...",
              );
              // Stamp the lifecycle for the cooking-indicator ETA
              // countdown when we haven't already (the chat-image
              // and chat-3D branches below pre-stamp from
              // `_generationMode`; the public proxy / sub-step
              // callers reach us only via the SSE event).
              if (
                (mode === "image" || mode === "video" || mode === "3d") &&
                getStreamEntry(core.key)?.generationStartedAt == null
              ) {
                setters.setGenerationState({
                  startedAt: Date.now(),
                  model: selectedModel ?? null,
                  kind: mode,
                });
              }
              break;
            }
            case EventType.GenerationProgress:
              core.setProgressText(event.content.message || `${event.content.percent}%`);
              setters.setGenerationPercent(event.content.percent);
              break;
            case EventType.GenerationPartialImage:
              // Partial-image frames carry no text we want to render,
              // but they ARE wire activity. Without this ack the 60s
              // stuck-stream watchdog (`useStuckStreamAutoTimeout`)
              // auto-aborts long partial-image renders like
              // `gpt-image-2` whose `progress` events are sparser than
              // the 60s window.
              markStreamProgress(core.key);
              break;
            case EventType.GenerationCompleted: {
              const gc = event.content;
              const toolName =
                gc.mode === "3d" ? "generate_3d_model" :
                gc.mode === "video" ? "generate_video" :
                "generate_image";
              const toolId = `gen-${Date.now()}`;
              handleToolCall(refs, setters, { id: toolId, name: toolName, input: {} });
              handleToolResult(refs, setters, { id: toolId, name: toolName, result: JSON.stringify(gc), is_error: false });
              setters.clearGeneration();
              inFlightRef.current = false;
              finalizeStream(refs, setters, abortRef, false, { reason: "completed", breadcrumbContext });
              break;
            }
            case EventType.GenerationError:
              setters.clearGeneration();
              inFlightRef.current = false;
              handleStreamError(refs, setters, event.content.message, breadcrumbContext);
              break;
            case EventType.Error:
              inFlightRef.current = false;
              handleStreamError(refs, setters, event.content.message, breadcrumbContext);
              break;
            case EventType.Done:
              inFlightRef.current = false;
              finalizeStream(refs, setters, abortRef, false, { breadcrumbContext });
              break;
          }
        },
        onError: (error) => {
          if (controller.signal.aborted) return;
          inFlightRef.current = false;
          handleStreamError(refs, setters, error, breadcrumbContext);
        },
        onDone: () => {
          if (controller.signal.aborted) return;
          inFlightRef.current = false;
          finalizeStream(refs, setters, abortRef, false, { breadcrumbContext });
        },
      };

      try {
        const shouldStartNewSession = nextSendStartsNewSessionRef.current;
        nextSendStartsNewSessionRef.current = false;
        if (_generationMode === "image") {
          core.setProgressText("Generating image...");
          // Stamp the generation lifecycle synchronously so the
          // cooking-indicator ETA countdown starts the moment the
          // user hits send rather than waiting for the upstream
          // `generation_start` SSE frame to arrive.
          setters.setGenerationState({
            startedAt: Date.now(),
            model: selectedModel ?? null,
            kind: "image",
          });
          // Forward `agentId` (and `projectId` when present) so the
          // server can resolve the agent's chat session and persist
          // this turn into history — without it the synthesized
          // `generate_image` tool turn is in-memory only and is lost
          // on hard reload.
          await generateImageStream(
            userMsg.content,
            selectedModel,
            attachments,
            handler,
            controller.signal,
            { agentId, projectId },
            shouldStartNewSession,
            shouldStartNewSession ? null : sessionIdRef.current,
          );
          return;
        }

        if (_generationMode === "3d") {
          // Chat 3D mode is a two-step in-bar pipeline (see
          // `use-chat-stream.ts` for the full rationale). Branch on
          // the pinned source image: image step when no thumb,
          // model step when one is pinned.
          if (!_sourceImageUrl) {
            const styledPrompt = `${userMsg.content}${STYLE_LOCK_SUFFIX}`;
            core.setProgressText("Generating image...");
            setters.setGenerationState({
              startedAt: Date.now(),
              model: DEFAULT_IMAGE_MODEL_ID,
              kind: "image",
            });
            await generateImageStream(
              styledPrompt,
              DEFAULT_IMAGE_MODEL_ID,
              attachments,
              {
                ...handler,
                onEvent(event) {
                  handler.onEvent(event);
                  if (
                    event.type === EventType.GenerationCompleted &&
                    event.content.mode === "image" &&
                    event.content.imageUrl
                  ) {
                    useChatUIStore.getState().setPinnedSourceImage(core.key, {
                      imageUrl: event.content.imageUrl,
                      originalUrl: event.content.originalUrl,
                      // Persist the user's verbatim prompt (without the
                      // style suffix) so the thumb tooltip / future
                      // refinement chips read naturally.
                      prompt: userMsg.content,
                    });
                  }
                },
              },
              controller.signal,
              { agentId, projectId },
              shouldStartNewSession,
              shouldStartNewSession ? null : sessionIdRef.current,
            );
            return;
          }
          core.setProgressText("Generating 3D model...");
          setters.setGenerationState({
            startedAt: Date.now(),
            model: selectedModel ?? null,
            kind: "3d",
          });
          await generate3dStream(
            { kind: "url", imageUrl: _sourceImageUrl },
            trimmed || null,
            {
              ...handler,
              onEvent(event) {
                handler.onEvent(event);
                if (
                  event.type === EventType.GenerationCompleted &&
                  event.content.mode === "3d" &&
                  event.content.glbUrl
                ) {
                  useChatUIStore.getState().setPinnedSourceImage(core.key, null);
                }
              },
            },
            controller.signal,
            projectId,
            undefined,
            agentId,
            undefined,
            shouldStartNewSession,
            shouldStartNewSession ? null : sessionIdRef.current,
          );
          return;
        }

        if (_generationMode === "video") {
          core.setProgressText("Generating video...");
          setters.setGenerationState({
            startedAt: Date.now(),
            model: selectedModel ?? null,
            kind: "video",
          });
          await generateVideoStream(
            {
              prompt: userMsg.content,
              model: selectedModel ?? undefined,
              projectId,
              agentId,
              newSession: shouldStartNewSession,
              sessionId: shouldStartNewSession ? null : sessionIdRef.current,
            },
            handler,
            controller.signal,
          );
          return;
        }

        const modelForTurn = _generationMode ? null : selectedModel;
        await api.agents.sendEventStream(
          agentId,
          userMsg.content,
          action,
          modelForTurn,
          attachments,
          handler,
          controller.signal,
          commands,
          projectId,
          shouldStartNewSession,
          shouldStartNewSession ? null : sessionIdRef.current,
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err, breadcrumbContext);
      } finally {
        // `inFlightRef` is gated by the same "still my turn" sentinel
        // as the rest of the cleanup. A "Send now" path calls
        // `stopStreaming` (which aborts THIS controller, clears the
        // latch synchronously, and resets `abortRef.current` to null
        // via `baseStopStreaming`) and immediately dispatches a fresh
        // `sendMessage` whose own try-block sets `inFlightRef = true`.
        // The aborted turn's microtask-deferred `finally` would
        // otherwise clobber that new latch even though `abortRef`
        // has moved on.
        if (abortRef.current === controller) {
          core.setIsStreaming(false);
          controller.abort();
          abortRef.current = null;
          inFlightRef.current = false;
        }
      }
    },
    [agentId, core.key, refs, setters, abortRef, core.setEvents, core.setIsStreaming, core.setProgressText],
  );

  // Register the live `sendMessage` callable into the replay map so
  // the Phase 2 stuck-stream pill can re-fire the cached args
  // without touching the hook's return surface. The cleanup clears
  // only this hook's slot so unmounting doesn't strand a stale
  // closure that captures a torn-down React tree.
  useEffect(() => {
    const entry = getOrCreateReplayEntry(core.key);
    const adapted = (args: AgentChatLastSendArgs): Promise<void> =>
      sendMessage(
        args.content,
        args.action,
        args.selectedModel,
        args.attachments,
        args.commands,
        args.projectId,
        args.generationMode,
        args.sourceImageUrl,
      );
    entry.sendFn = adapted;
    return () => {
      if (entry.sendFn === adapted) entry.sendFn = null;
    };
  }, [core.key, sendMessage]);

  // Stable callback identity so callers do not need to wrap it in a
  // `useRef` mirror. See the matching block in `useChatStream`.
  const markNextSendAsNewSession = useCallback(() => {
    nextSendStartsNewSessionRef.current = true;
  }, []);

  // Wrap `baseStopStreaming` so we clear `inFlightRef` in the same
  // synchronous tick the user (or a "Send now" force-send) cancels
  // the turn. Without this, a follow-up `sendMessage` invoked right
  // after `stopStreaming` sees the stale `inFlightRef.current === true`
  // and silently returns, swallowing the force-sent prompt. The
  // outer async `sendMessage` only resets the latch from its `finally`
  // block after the SSE close propagates, which is too late.
  const stopStreaming = useCallback(() => {
    inFlightRef.current = false;
    core.baseStopStreaming();
  }, [core.baseStopStreaming]);

  return {
    streamKey: core.key,
    sendMessage,
    stopStreaming,
    resetEvents: core.resetEvents,
    markNextSendAsNewSession,
  };
}
