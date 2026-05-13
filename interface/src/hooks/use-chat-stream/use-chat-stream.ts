import { useRef, useCallback, useEffect } from "react";
import { api } from "../../api/client";
import { generate3dStream, generateImageStream } from "../../api/streams";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { useChatUIStore } from "../../stores/chat-ui-store";
import type { ChatAttachment } from "../../api/streams";
import { DEFAULT_IMAGE_MODEL_ID, type GenerationMode } from "../../constants/models";
import { STYLE_LOCK_SUFFIX } from "../../constants/generation";
import { EventType } from "../../shared/types/aura-events";

import {
  useStreamCore,
  resetStreamBuffers,
  handleStreamError,
  getIsStreaming,
} from "../use-stream-core";
import { buildUserChatMessage } from "../attachment-helpers";
import { buildStreamHandler } from "./build-stream-handler";

type UseChatStreamSendMessage = (
  content: string,
  action?: string | null,
  selectedModel?: string | null,
  attachments?: ChatAttachment[],
  commands?: string[],
  projectIdOverride?: string,
  generationMode?: GenerationMode,
  sourceImageUrl?: string,
) => Promise<void>;

interface UseChatStreamOptions {
  projectId: string | undefined;
  agentInstanceId: string | undefined;
  /**
   * Pin this stream's send + SessionReady handling to a specific
   * historical session id. When set, every `sendMessage` is forwarded
   * to the server with `session_id=<id>` so the harness writes into
   * that exact session and rebuilds LLM context from its events. The
   * `+` button drops this back to `undefined` (URL `?session=` is
   * cleared upstream); the next send creates a fresh session and
   * `onSessionReady` fires with the new id.
   */
  sessionId?: string | null;
  /**
   * Called once per `SessionReady` whenever the server-assigned
   * session id changes. Replaces the old `useLiveSessionStore` pin
   * mechanism: the chat panel uses this to write `?session=<new-id>`
   * into the URL (via `setSearchParams({ replace: true })`), making
   * the URL the single source of truth for which session is being
   * extended.
   */
  onSessionReady?: (sessionId: string) => void;
}

export function useChatStream({
  projectId,
  agentInstanceId,
  sessionId,
  onSessionReady,
}: UseChatStreamOptions) {
  const sidekickRef = useRef(useSidekickStore.getState());
  const projectCtx = useProjectActions();
  const projectCtxRef = useRef(projectCtx);

  useEffect(() => useSidekickStore.subscribe((s) => { sidekickRef.current = s; }), []);
  useEffect(() => { projectCtxRef.current = projectCtx; }, [projectCtx]);

  const core = useStreamCore([projectId, agentInstanceId]);
  const { refs, setters, abortRef } = core;
  const pendingSpecIdsRef = useRef<string[]>([]);
  const pendingTaskIdsRef = useRef<string[]>([]);
  const nextSendStartsNewSessionRef = useRef(false);
  // `sessionId` and `onSessionReady` change whenever the URL
  // `?session=` flips. Reading them via refs in `sendMessage` keeps
  // the callback identity stable so the chat input bar's
  // `useCallback`s don't re-run on every URL update.
  const sessionIdRef = useRef(sessionId ?? null);
  useEffect(() => { sessionIdRef.current = sessionId ?? null; }, [sessionId]);
  const onSessionReadyRef = useRef(onSessionReady);
  useEffect(() => { onSessionReadyRef.current = onSessionReady; }, [onSessionReady]);
  // See `use-agent-chat-stream.ts`: synchronous latch covering the gap
  // between `sendMessage` invocation and the moment `setIsStreaming(true)`
  // propagates through Zustand. Without it two clicks (or a click + queue
  // dequeue replay) landing in the same microtask both pass the
  // `getIsStreaming` read and proceed to issue parallel POSTs.
  const inFlightRef = useRef(false);

  // Phase 2 auto-retry plumbing. When a chat turn dies mid-stream
  // because the harness WS dropped (or the SSE idle watchdog fires),
  // we silently re-issue the last user message on a fresh harness
  // session — the harness rebuilds context from `aura_session_id` in
  // storage. Bounded to `MAX_AUTO_RETRIES` to avoid hammering a
  // genuinely-down upstream.
  const MAX_AUTO_RETRIES = 2;
  interface LastSendArgs {
    content: string;
    action: string | null;
    selectedModel?: string | null;
    attachments?: ChatAttachment[];
    commands?: string[];
    projectIdOverride?: string;
    generationMode?: GenerationMode;
    sourceImageUrl?: string;
  }
  const lastSendArgsRef = useRef<LastSendArgs | null>(null);
  const autoRetryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flipped to `true` for the single sendMessage invocation scheduled
  // by the auto-retry timer. Lets the entry-point distinguish a
  // retry from a brand-new user send (which should reset the budget).
  const inAutoRetryRef = useRef(false);
  // sendMessage is defined below; ref-indirection so the auto-retry
  // callback can call the current `sendMessage` without re-binding
  // the dependency list of every memoized child that holds the
  // callback identity.
  const sendMessageRef = useRef<UseChatStreamSendMessage | null>(null);

  useEffect(
    () => () => {
      if (retryTimerRef.current != null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => () => {
    if (agentInstanceId && !getIsStreaming(core.key)) {
      sidekickRef.current.setAgentStreaming(agentInstanceId, false);
    }
  }, [projectId, agentInstanceId, core.key]);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      selectedModel?: string | null,
      attachments?: ChatAttachment[],
      commands?: string[],
      _projectIdOverride?: string,
      _generationMode?: GenerationMode,
      _sourceImageUrl?: string,
    ) => {
      if (!projectId || !agentInstanceId || inFlightRef.current || getIsStreaming(core.key)) return;

      // A user-initiated send (not the auto-retry timer firing)
      // resets the Phase 2 retry budget. Otherwise a user that
      // exhausted the budget once would never get a retry on their
      // next message even after a clean break.
      const isAutoRetry = inAutoRetryRef.current;
      inAutoRetryRef.current = false;
      if (!isAutoRetry) {
        autoRetryCountRef.current = 0;
      }

      // Capture every successful entry to `sendMessage` so the Phase 2
      // auto-retry path can re-issue the exact same call after a
      // transient WS drop. We snapshot BEFORE the empty-content guard
      // because the retry needs the original payload regardless of
      // whether the user typed text vs. relied on attachments.
      lastSendArgsRef.current = {
        content,
        action,
        selectedModel,
        attachments,
        commands,
        projectIdOverride: _projectIdOverride,
        generationMode: _generationMode,
        sourceImageUrl: _sourceImageUrl,
      };
      const trimmed = content.trim();
      // 3D model step (`generationMode === "3d"` with a pinned source image)
      // dispatches without text or attachments — the source image is the
      // payload — so let it through the empty-content guard.
      const is3DModelStep =
        _generationMode === "3d" && typeof _sourceImageUrl === "string" && _sourceImageUrl.length > 0;
      if (
        !trimmed &&
        !action &&
        !(attachments && attachments.length > 0) &&
        !is3DModelStep
      )
        return;

      inFlightRef.current = true;

      const userMsg = buildUserChatMessage(
        trimmed,
        attachments,
        action === "generate_specs"
          ? "Generate specs for this project"
          : is3DModelStep
            ? "Generate 3D model"
            : undefined,
      );
      // On an auto-retry, the user's bubble is already on screen from
      // the original send — only the assistant turn is being re-issued
      // — so re-appending it here would duplicate the question. The
      // partial assistant buffer was already discarded in `tryAutoRetry`.
      if (!isAutoRetry) {
        core.setEvents((prev) => [...prev, userMsg]);
      }
      core.setIsStreaming(true);
      sidekickRef.current.setAgentStreaming(agentInstanceId, true);
      resetStreamBuffers(refs, setters);
      pendingSpecIdsRef.current = [];
      pendingTaskIdsRef.current = [];

      if (action === "generate_specs") {
        sidekickRef.current.clearGeneratedArtifacts();
        sidekickRef.current.setActiveTab("specs");
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const tryAutoRetry = (_error: unknown): boolean => {
        // Never auto-retry if the user explicitly aborted the turn
        // (Stop button) — that controller is the same one we'd
        // re-attach to, so respect their intent.
        if (controller.signal.aborted) return false;
        if (abortRef.current?.signal.aborted) return false;
        if (autoRetryCountRef.current >= MAX_AUTO_RETRIES) return false;
        const args = lastSendArgsRef.current;
        if (!args) return false;
        autoRetryCountRef.current += 1;
        const delayMs = 1000 * autoRetryCountRef.current;
        // Discard any partial assistant state from the dropped turn
        // so the retry produces a clean assistant bubble. The user's
        // own message remains on screen because it's already in
        // `events` and the retry skips re-appending it.
        resetStreamBuffers(refs, setters);
        // Swap the would-be error bubble for a transient "Reconnecting"
        // banner. The next send will rehydrate from session history
        // (the harness picks up by `aura_session_id`).
        core.setProgressText("Reconnecting…");
        // We can't fire the resend synchronously because the current
        // `sendMessage` call is still on the stack and `inFlightRef` /
        // `setIsStreaming(true)` will fight a re-entrant invocation.
        // Defer past the surrounding `finally` so the latch is clear
        // by the time the retry runs.
        if (retryTimerRef.current != null) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          const send = sendMessageRef.current;
          if (!send) return;
          inAutoRetryRef.current = true;
          void send(
            args.content,
            args.action,
            args.selectedModel,
            args.attachments,
            args.commands,
            args.projectIdOverride,
            args.generationMode,
            args.sourceImageUrl,
          );
        }, delayMs);
        return true;
      };

      const handler = buildStreamHandler({
        projectId, agentInstanceId, selectedModel, refs, setters, abortRef, coreKey: core.key,
        setProgressText: core.setProgressText, sidekickRef, projectCtxRef,
        pendingSpecIdsRef, pendingTaskIdsRef,
        onSessionReady: (id) => onSessionReadyRef.current?.(id),
        onAssistantTurnCompleted: () => {
          autoRetryCountRef.current = 0;
        },
        onMaybeAutoRetry: tryAutoRetry,
      });

      try {
        const shouldStartNewSession = nextSendStartsNewSessionRef.current;
        nextSendStartsNewSessionRef.current = false;
        if (_generationMode === "image") {
          core.setProgressText("Generating image...");
          // Forward project + agent-instance ids so the server can
          // resolve the project chat session and persist this turn
          // into history — without it the synthesized `generate_image`
          // tool turn is in-memory only and is lost on hard reload.
          await generateImageStream(
            userMsg.content,
            selectedModel,
            attachments,
            handler,
            controller.signal,
            { projectId, agentInstanceId },
          );
          return;
        }

        if (_generationMode === "3d") {
          // Chat 3D mode is a two-step in-bar pipeline:
          //   - no pinned source image → run the AURA-styled image
          //     step and pin the result so the next send can
          //     convert it to 3D;
          //   - pinned source image → run the image-to-3D model step
          //     against the pinned URL and clear the pin on
          //     completion.
          // The branch is keyed on `_sourceImageUrl`, which the
          // panel-state layer sources from the per-stream pinned
          // image slice in `chat-ui-store` (NOT from chat history).
          if (!_sourceImageUrl) {
            const styledPrompt = `${userMsg.content}${STYLE_LOCK_SUFFIX}`;
            core.setProgressText("Generating image...");
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
              { projectId, agentInstanceId },
            );
            return;
          }
          core.setProgressText("Generating 3D model...");
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
          );
          return;
        }

        const modelForTurn = _generationMode ? null : selectedModel;
        await api.sendEventStream(
          projectId,
          agentInstanceId,
          userMsg.content,
          action,
          modelForTurn,
          attachments,
          handler,
          controller.signal,
          commands,
          shouldStartNewSession,
          shouldStartNewSession ? null : sessionIdRef.current,
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err);
      } finally {
        if (abortRef.current === controller) {
          core.setIsStreaming(false);
          sidekickRef.current.setAgentStreaming(agentInstanceId, false);
          controller.abort();
          abortRef.current = null;
        }
        // Whatever path we took out (success, error, abort), drop any
        // placeholders that were never promoted. Safe because successful
        // promotions have already removed themselves from these refs.
        for (const id of pendingSpecIdsRef.current) {
          sidekickRef.current.removeSpec(id);
        }
        pendingSpecIdsRef.current = [];
        for (const id of pendingTaskIdsRef.current) {
          sidekickRef.current.removeTask(id);
        }
        pendingTaskIdsRef.current = [];
        inFlightRef.current = false;
      }
    },
    [projectId, agentInstanceId, core.key, refs, setters, abortRef, core.setEvents, core.setIsStreaming, core.setProgressText],
  );

  // Mirror the live `sendMessage` identity into a ref so the
  // auto-retry timer (scheduled below) can call the current closure
  // without re-rendering every memoized child whenever the callback
  // identity changes.
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const stopStreaming = useCallback(() => {
    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    autoRetryCountRef.current = 0;
    core.baseStopStreaming();
    if (agentInstanceId) {
      sidekickRef.current.setAgentStreaming(agentInstanceId, false);
    }
    if (projectId && agentInstanceId) {
      const refetch = () => {
        api.getAgentInstance(projectId, agentInstanceId).then((instance) => {
          sidekickRef.current.notifyAgentInstanceUpdate(instance);
        }).catch(() => {});
      };
      setTimeout(refetch, 2000);
      setTimeout(refetch, 5000);
    }
  }, [projectId, agentInstanceId, core.baseStopStreaming]);

  // Stable callback identity so callers do not need to wrap it in a
  // `useRef` mirror. The ref it mutates is local and per-hook-instance,
  // so the closure can be reused across renders without churning props
  // on memoized children.
  const markNextSendAsNewSession = useCallback(() => {
    nextSendStartsNewSessionRef.current = true;
    // New chat means a fresh auto-retry budget for any future
    // transient WS drop on the new session.
    autoRetryCountRef.current = 0;
    lastSendArgsRef.current = null;
    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  return {
    streamKey: core.key,
    sendMessage,
    stopStreaming,
    resetEvents: core.resetEvents,
    markNextSendAsNewSession,
  };
}
