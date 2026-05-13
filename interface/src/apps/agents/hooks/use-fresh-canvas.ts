import { useCallback, useEffect, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import {
  agentHistoryKey,
  projectChatHistoryKey,
  useChatHistoryStore,
} from "../../../stores/chat-history-store";
import { useContextUsageStore } from "../../../stores/context-usage-store";
import { useSessionsListStore } from "../../../stores/sessions-list-store";
import { getIsStreaming, useStreamStore } from "../../../hooks/stream/store";
import type { DisplaySessionEvent } from "../../../shared/types/stream";

interface UseFreshCanvasOptions {
  projectId: string;
  agentInstanceId: string;
  /** Org-level template agent id; used for cross-key history clears so a
   *  standalone-agent fresh canvas doesn't resurrect stale events from the
   *  project-route key. May be null when bindings aren't resolved yet. */
  orgAgentId: string | null;
  streamKey: string;
  sessionId: string | null;
  /** The chat-history-store key currently driving the panel. Cleared when
   *  the user starts a fresh canvas. */
  historyKey: string;
  setSearchParams: SetURLSearchParams;
  /** From `useChatStream` / `useAgentChatStream`. */
  resetEvents: (
    events: DisplaySessionEvent[],
    options?: { allowWhileStreaming?: boolean },
  ) => void;
  markNextSendAsNewSession: () => void;
}

interface UseFreshCanvasResult {
  /** Increments each time the user starts a fresh canvas in the same
   *  `(project, instance)` lane without an intervening `?session=`. */
  freshChatNonce: number;
  /** Whether the panel is sitting on a fresh canvas — no `?session=` and
   *  the user has at least once started a new chat in this mount. */
  freshCanvasPending: boolean;
  /** Equivalent to "RotateCcw" in the ChatPanel input bar — the chat
   *  history-store entry is dropped, the URL session is cleared, the next
   *  send arms a new session. */
  newSession: () => void;
  /** Equivalent to "+" in the ChatPanel input bar — same as `newSession`
   *  plus optimistic side-effects (cross-key clears for standalone, sessions
   *  store version bump). */
  newChat: () => void;
}

/**
 * Single owner of the "+" / "RotateCcw" reset semantics that used to be
 * spread across `handleNewSession` and `handleNewChat` in the old
 * `AgentChatPanel`. Both actions:
 *   - Mark the next stream send as starting a new session server-side.
 *   - Drop the chat-history-store entry for the current key.
 *   - Wipe the local stream slot.
 *   - Reset context-utilization tracking.
 *   - Delete `?session=` from the URL.
 *
 * `newChat` adds two extra responsibilities:
 *   - Cross-key clears so a standalone-agent fallback render never sees
 *     stale events from a project-route key (or vice versa).
 *   - Version bump on the sessions store so sidekick lists refresh.
 */
export function useFreshCanvas(opts: UseFreshCanvasOptions): UseFreshCanvasResult {
  const {
    projectId,
    agentInstanceId,
    orgAgentId,
    streamKey,
    sessionId,
    historyKey,
    setSearchParams,
    resetEvents,
    markNextSendAsNewSession,
  } = opts;

  const [freshChatNonce, setFreshChatNonce] = useState(0);
  const freshCanvasPending = !sessionId && freshChatNonce > 0;

  // When SessionReady writes a real session into `?session=`, we are no
  // longer on a fresh canvas. Reset the nonce so the historyKey switches
  // back from `fresh:...` to `session:...`.
  useEffect(() => {
    if (sessionId) {
      setFreshChatNonce(0);
    }
  }, [sessionId]);

  // Drop only `?session=`. The agents-shell `?project=&instance=`
  // mirrors must stay so `useConversationTarget` keeps resolving to
  // the same `(projectId, agentInstanceId)` lane and `AgentChatPanel`
  // stays mounted across the "+" press. If we cleared the triple, the
  // resolver would flip to `kind: "empty"` and `AgentChatRoute` would
  // swap us out for `StandaloneAgentChatPanel` — the unmount cleanup
  // in `useOptimisticSessionRow` would then yank the just-armed
  // optimistic "New chat" row, and the new panel would re-fetch the
  // agent's full timeline so the transcript would not appear cleared.
  //
  // Trade-off: the picker label still reads the legacy project name
  // for legacy agents on a fresh canvas (the wire `body.project_id`
  // is also the legacy id here, since `AgentChatPanel` ships
  // `llmProjectId={projectId}`). That's the same behaviour we had
  // before commit f28e2c62a; ship a dedicated agents-shell-aware
  // picker/wire override on top of `AgentChatPanel` to fix it without
  // reintroducing the panel-swap regression.
  const dropSessionParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("session");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const clearStreamSlot = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const clearContextUsage = useCallback(() => {
    const ctx = useContextUsageStore.getState();
    ctx.clearContextUtilization(streamKey);
    ctx.markResetPending(streamKey);
  }, [streamKey]);

  const newSession = useCallback(() => {
    void import("../../../lib/analytics").then(({ track }) => track("chat_session_reset"));
    markNextSendAsNewSession();
    useChatHistoryStore.getState().clearHistory(historyKey);
    setFreshChatNonce((n) => n + 1);
    clearStreamSlot();
    clearContextUsage();
    dropSessionParam();
  }, [
    markNextSendAsNewSession,
    historyKey,
    clearStreamSlot,
    clearContextUsage,
    dropSessionParam,
  ]);

  const newChat = useCallback(() => {
    void import("../../../lib/analytics").then(({ track }) => track("chat_new_chat"));
    markNextSendAsNewSession();
    const historyStore = useChatHistoryStore.getState();
    historyStore.clearHistory(historyKey);
    historyStore.clearHistory(projectChatHistoryKey(projectId, agentInstanceId));
    if (orgAgentId) {
      historyStore.clearHistory(agentHistoryKey(orgAgentId));
      // Wipe the standalone stream slot too, for routes that fall back
      // to the standalone fresh-canvas panel.
      const standaloneStreamKey = orgAgentId;
      if (!getIsStreaming(standaloneStreamKey)) {
        useStreamStore.setState((s) => {
          const entry = s.entries[standaloneStreamKey];
          if (!entry || entry.events.length === 0) return s;
          return {
            entries: {
              ...s.entries,
              [standaloneStreamKey]: { ...entry, events: [] },
            },
          };
        });
      }
    }
    setFreshChatNonce((n) => n + 1);
    clearStreamSlot();
    clearContextUsage();
    dropSessionParam();
    useSessionsListStore.getState().bumpVersion();
  }, [
    markNextSendAsNewSession,
    historyKey,
    projectId,
    agentInstanceId,
    orgAgentId,
    clearStreamSlot,
    clearContextUsage,
    dropSessionParam,
  ]);

  return { freshChatNonce, freshCanvasPending, newSession, newChat };
}
