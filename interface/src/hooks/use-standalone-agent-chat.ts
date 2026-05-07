import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { api, STANDALONE_AGENT_HISTORY_LIMIT } from "../api/client";
import { useAgentChatStream } from "./use-agent-chat-stream";
import { useChatHistorySync } from "./use-chat-history-sync";
import { getIsStreaming } from "./stream/store";
import { useDelayedLoading } from "../shared/hooks/use-delayed-loading";
import { useStandaloneAgentMeta } from "./use-agent-chat-meta";
import {
  agentHistoryKey,
  projectChatHistoryKey,
  useChatHistoryStore,
} from "../stores/chat-history-store";
import {
  agentSessionsSurfaceKey,
  buildOptimisticSession,
  OPTIMISTIC_SESSION_ID_PREFIX,
  projectSessionsSurfaceKey,
  useSessionsListStore,
} from "../stores/sessions-list-store";
import { useAgentStore } from "../apps/agents/stores";
import { useProjectsListStore } from "../stores/projects-list-store";
import { useContextUsage, useContextUsageStore } from "../stores/context-usage-store";
import { useHydrateContextUtilization } from "./use-hydrate-context-utilization";
import type { ChatPanelProps } from "../apps/chat/components/ChatPanel";
import type { AgentInstance, Project } from "../shared/types";

const AGENT_PROJECT_KEY_PREFIX = "aura-agent-project:";
const EMPTY_PROJECTS: Project[] = [];
const EMPTY_SESSION_EVENTS_FETCH = () => Promise.resolve([]);

function selectProjectsForAgent(agentId: string | undefined) {
  return (state: { projects: Project[]; agentsByProject: Record<string, AgentInstance[]> }) => {
    if (!agentId) return EMPTY_PROJECTS;
    return state.projects.filter((project) => {
      const instances = state.agentsByProject[project.project_id];
      return instances?.some((instance) => instance.agent_id === agentId);
    });
  };
}

function loadPersistedProject(agentId: string): string | undefined {
  try {
    return localStorage.getItem(`${AGENT_PROJECT_KEY_PREFIX}${agentId}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistAgentProject(agentId: string, projectId: string) {
  try {
    localStorage.setItem(`${AGENT_PROJECT_KEY_PREFIX}${agentId}`, projectId);
  } catch { /* ignore */ }
}

/**
 * Single source of truth for standalone-agent chat wiring.
 *
 * Both the route view (`/agents/:agentId` -> `StandaloneAgentChatPanel`) and the
 * floating desktop window (`AgentWindow`) consume this hook so the two surfaces
 * stay behaviourally identical. Route-only concerns (`scrollToBottomOnReset`,
 * `initialHandoff`, `LAST_AGENT_ID_KEY` persistence) are layered on top by the
 * caller after the fact.
 *
 * Returns `ChatPanelProps`. `agentId` may be undefined to support the
 * floating-window mount race where the window is rendered before the agent
 * list has resolved. `pinnedSessionId` (sourced from `?session=`) scopes the
 * panel to a specific historical session — sends and history fetches both
 * thread it through to the server.
 */
export function useStandaloneAgentChat(
  agentId: string | undefined,
  pinnedSessionId: string | null = null,
  opts: { freshCanvasPending?: boolean } = {},
): ChatPanelProps {
  const agentProjects = useProjectsListStore(useShallow(selectProjectsForAgent(agentId)));
  const [, setSearchParams] = useSearchParams();

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (!agentId) return undefined;
    return loadPersistedProject(agentId);
  });

  useEffect(() => {
    if (!agentId) return;
    setSelectedProjectId(loadPersistedProject(agentId));
  }, [agentId]);

  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId && agentProjects.some((project) => project.project_id === selectedProjectId)) {
      return selectedProjectId;
    }
    return agentProjects[0]?.project_id;
  }, [selectedProjectId, agentProjects]);

  const handleProjectChange = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      if (agentId) persistAgentProject(agentId, projectId);
    },
    [agentId],
  );

  // Tracks the optimistic placeholder id this hook inserted into the
  // SessionsList store on the most recent fresh-chat send. When
  // `SessionReady` lands, we swap the synthetic id for the real one
  // in place. See the matching ref in `ProjectAgentChatPanel`.
  const pendingOptimisticIdRef = useRef<string | null>(null);
  // Mirror `agentId` and the project binding via refs so the
  // `SessionReady`-side reconciliation doesn't ride along in
  // `handleSessionReady`'s deps. The chat input bar's `onSend`/internal
  // wiring is sensitive to identity churn from the projects store.
  const agentIdRef = useRef(agentId);
  useEffect(() => { agentIdRef.current = agentId; }, [agentId]);
  const optimisticBindingRef = useRef<{
    projectId: string;
    projectName: string;
    agentInstanceId: string;
  } | null>(null);

  // Mirror the server-assigned session id back into the URL so the
  // panel reuses the same routing contract on every send. See the
  // matching effect in `ProjectAgentChatPanel`.
  const handleSessionReady = useCallback(
    (newSessionId: string) => {
      const pendingOptimisticId = pendingOptimisticIdRef.current;
      if (pendingOptimisticId) {
        pendingOptimisticIdRef.current = null;
        const sessionsStore = useSessionsListStore.getState();
        const resolvedAgentId = agentIdRef.current;
        if (resolvedAgentId) {
          sessionsStore.replaceSessionId(
            agentSessionsSurfaceKey(resolvedAgentId),
            pendingOptimisticId,
            newSessionId,
          );
        }
        const binding = optimisticBindingRef.current;
        optimisticBindingRef.current = null;
        if (binding) {
          sessionsStore.replaceSessionId(
            projectSessionsSurfaceKey(binding.projectId),
            pendingOptimisticId,
            newSessionId,
          );
        }
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (next.get("session") === newSessionId) return prev;
          next.set("session", newSessionId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const { streamKey, sendMessage, stopStreaming, resetEvents, markNextSendAsNewSession } =
    useAgentChatStream({
      agentId,
      sessionId: pinnedSessionId,
      onSessionReady: handleSessionReady,
    });

  const { agentName, machineType, templateAgentId, adapterType, defaultModel } =
    useStandaloneAgentMeta(agentId);

  const contextUsage = useContextUsage(streamKey);
  const [freshChatNonce, setFreshChatNonce] = useState(0);
  const freshCanvasPending = !pinnedSessionId && (opts.freshCanvasPending || freshChatNonce > 0);

  useEffect(() => {
    if (pinnedSessionId) {
      setFreshChatNonce(0);
    }
  }, [pinnedSessionId]);

  // Clear the stream slot whenever the user navigates between two
  // historical sessions. Mirrors the same effect in
  // `ProjectAgentChatPanel`; see that comment for the full rationale
  // on why only the `defined → different-defined` transition is
  // allowed to clear, and only when no turn is actively streaming.
  const prevPinnedSessionIdRef = useRef<string | null>(pinnedSessionId);
  useEffect(() => {
    const previous = prevPinnedSessionIdRef.current;
    prevPinnedSessionIdRef.current = pinnedSessionId;
    if (previous === pinnedSessionId) return;
    if (previous === null || pinnedSessionId === null) return;
    if (getIsStreaming(streamKey)) return;
    resetEvents([], { allowWhileStreaming: true });
  }, [pinnedSessionId, resetEvents, streamKey]);

  const historyKey = useMemo(() => {
    if (!agentId) return undefined;
    if (freshCanvasPending) {
      return `agent:${agentId}:fresh:${freshChatNonce || "route"}`;
    }
    if (pinnedSessionId) {
      return `agent:${agentId}:session:${pinnedSessionId}`;
    }
    return agentHistoryKey(agentId);
  }, [agentId, freshCanvasPending, freshChatNonce, pinnedSessionId]);

  const fetchFn = useMemo(() => {
    if (!agentId) return undefined;
    if (freshCanvasPending) {
      return EMPTY_SESSION_EVENTS_FETCH;
    }
    // Standalone-agent chats don't expose a per-session events
    // endpoint yet — the agents-app session branch routes through
    // `ProjectAgentChatPanel` which uses `api.listSessionEvents`. For
    // the bare `/agents/:agentId` view we hit the per-agent timeline;
    // when a `pinnedSessionId` is set, the historyKey above gives us
    // a clean cache slot but the events still come from the same
    // endpoint until a per-session standalone API ships.
    return () =>
      api.agents.listEvents(agentId, {
        limit: STANDALONE_AGENT_HISTORY_LIMIT,
      });
  }, [agentId, freshCanvasPending]);

  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const onSwitch = useCallback(() => {
    if (!agentId) return;
    setSelectedAgent(agentId);
  }, [agentId, setSelectedAgent]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const handleNewSession = useCallback(() => {
    if (!agentId) return;
    void import("../lib/analytics").then(({ track }) => track("chat_session_reset"));
    markNextSendAsNewSession();
    if (historyKey) {
      useChatHistoryStore.getState().clearHistory(historyKey);
    }
    setFreshChatNonce((nonce) => nonce + 1);
    resetEvents([], { allowWhileStreaming: true });
    const store = useContextUsageStore.getState();
    store.clearContextUtilization(streamKey);
    // Mark a reset sentinel so the hydration hook doesn't resurrect the old
    // session's value if the view remounts before the next send (e.g. nav
    // away and back).
    store.markResetPending(streamKey);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("session");
        return next;
      },
      { replace: true },
    );
  }, [agentId, markNextSendAsNewSession, streamKey, historyKey, resetEvents, setSearchParams]);

  // Set in `handleNewChat`, consumed inside the `wrappedSend` wrapper
  // to decide whether to insert an optimistic SessionsList row on the
  // very next send. See the matching ref in `ProjectAgentChatPanel`.
  const pendingOptimisticArmedRef = useRef(false);

  const handleNewChat = useCallback(() => {
    if (!agentId) return;
    void import("../lib/analytics").then(({ track }) => track("chat_new_chat"));
    markNextSendAsNewSession();
    pendingOptimisticArmedRef.current = true;
    const historyStore = useChatHistoryStore.getState();
    if (historyKey) {
      historyStore.clearHistory(historyKey);
    }
    // Symmetric destination-key clear: the standalone hook still
    // clears its own `agentHistoryKey(agentId)` above, but if the
    // user's first send fires `SessionReady` and we get bound to a
    // `(project, instance)` pair, the URL flips and the next mount
    // may key off `projectChatHistoryKey(...)` instead. Clearing
    // here keeps the destination clean across that flip so a stale
    // project-route entry can't leak old events into the fresh
    // canvas. We look the instance up off the projects-list-store
    // for the agent's currently effective project (the same value
    // the hook already exposes via `effectiveProjectId`).
    if (effectiveProjectId) {
      const projectsState = useProjectsListStore.getState();
      const instances = projectsState.agentsByProject[effectiveProjectId];
      const matchedInstance = instances?.find(
        (instance) => instance.agent_id === agentId,
      );
      if (matchedInstance) {
        historyStore.clearHistory(
          projectChatHistoryKey(effectiveProjectId, matchedInstance.agent_instance_id),
        );
      }
    }
    setFreshChatNonce((nonce) => nonce + 1);
    resetEvents([], { allowWhileStreaming: true });
    const ctxStore = useContextUsageStore.getState();
    ctxStore.clearContextUtilization(streamKey);
    ctxStore.markResetPending(streamKey);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("session");
        return next;
      },
      { replace: true },
    );
    const sessionsStore = useSessionsListStore.getState();
    sessionsStore.bumpVersion();
  }, [agentId, markNextSendAsNewSession, streamKey, historyKey, effectiveProjectId, resetEvents, setSearchParams]);

  const contextUsageFetcher = useMemo(() => {
    if (!agentId) return undefined;
    return (signal: AbortSignal) => api.agents.getContextUsage(agentId, { signal });
  }, [agentId]);

  useHydrateContextUtilization(streamKey, contextUsageFetcher, agentId);

  const { historyMessages, historyResolved, isLoading, historyError, wrapSend } =
    useChatHistorySync({
      historyKey,
      streamKey,
      fetchFn,
      resetEvents,
      invalidateBeforeFetch: false,
      suppressHistoryFetch: freshCanvasPending,
      onSwitch,
      onClear,
      hydrateToStream: false,
      // Standalone agent chats are keyed by the org-level `agent_id`
      // (see `agentHistoryKey`), so we subscribe to that axis — not
      // `project_agent_id`. Without this, a `send_to_agent` delivery
      // persists into the target agent's session but the chat panel
      // stays stale until the user hits F5.
      watchAgentId: agentId,
    });

  const wrappedSendBase = useMemo(
    () => wrapSend(sendMessage),
    [wrapSend, sendMessage],
  );
  // Insert an optimistic "New chat" row into the SessionsList store
  // the first time the user sends after pressing `+`. Mirrors the
  // wrapper in `ProjectAgentChatPanel`. Skips the projects-app
  // surface insert if the standalone agent has no resolvable project
  // binding yet (no row to add — the user is on a truly fresh canvas
  // with no project-side sidekick visible).
  const insertOptimisticSessionRow = useCallback((): string | null => {
    if (!agentId) return null;
    const projectsState = useProjectsListStore.getState();
    let resolvedBinding: {
      projectId: string;
      projectName: string;
      agentInstanceId: string;
    } | null = null;
    if (effectiveProjectId) {
      const project = projectsState.projects.find(
        (p) => p.project_id === effectiveProjectId,
      );
      const instances = projectsState.agentsByProject[effectiveProjectId];
      const matchedInstance = instances?.find(
        (instance) => instance.agent_id === agentId,
      );
      if (project && matchedInstance) {
        resolvedBinding = {
          projectId: project.project_id,
          projectName: project.name,
          agentInstanceId: matchedInstance.agent_instance_id,
        };
      }
    }
    if (!resolvedBinding) {
      // Without a project binding we can't construct an
      // `AnnotatedSession` (it requires `_projectId` /
      // `_agentInstanceId` for navigation back into a chat). Bail —
      // the row will appear after `SessionReady`'s `bumpVersion`
      // refetches.
      return null;
    }
    const optimisticId =
      `${OPTIMISTIC_SESSION_ID_PREFIX}${typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
    const optimisticSession = buildOptimisticSession({
      optimisticId,
      projectId: resolvedBinding.projectId,
      projectName: resolvedBinding.projectName,
      agentInstanceId: resolvedBinding.agentInstanceId,
    });
    const sessionsStore = useSessionsListStore.getState();
    sessionsStore.addOptimisticSession(
      agentSessionsSurfaceKey(agentId),
      optimisticSession,
    );
    sessionsStore.addOptimisticSession(
      projectSessionsSurfaceKey(resolvedBinding.projectId),
      optimisticSession,
    );
    optimisticBindingRef.current = resolvedBinding;
    return optimisticId;
  }, [agentId, effectiveProjectId]);
  const wrappedSend = useMemo(
    () =>
      (...args: Parameters<typeof wrappedSendBase>) => {
        if (pendingOptimisticArmedRef.current) {
          pendingOptimisticArmedRef.current = false;
          pendingOptimisticIdRef.current = insertOptimisticSessionRow();
        }
        return wrappedSendBase(...args);
      },
    [insertOptimisticSessionRow, wrappedSendBase],
  );

  const deferredLoading = useDelayedLoading(isLoading);
  const scrollResetKey = agentId
    ? freshCanvasPending
      ? `${agentId}:fresh:${freshChatNonce || "route"}`
      : agentId
    : undefined;

  return {
    streamKey,
    transcriptKey: historyKey,
    onSend: wrappedSend,
    onStop: stopStreaming,
    agentName,
    machineType,
    adapterType,
    defaultModel,
    templateAgentId,
    agentId,
    isLoading: deferredLoading,
    historyResolved,
    errorMessage: historyError ?? null,
    scrollResetKey,
    historyMessages,
    projects: agentProjects,
    selectedProjectId: effectiveProjectId,
    onProjectChange: handleProjectChange,
    contextUsage,
    onNewSession: handleNewSession,
    onNewChat: handleNewChat,
  };
}
