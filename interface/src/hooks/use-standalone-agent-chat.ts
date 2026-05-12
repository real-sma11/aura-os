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

// Markers for the server-side auto-created Home project. Kept in sync
// with `HOME_PROJECT_NAME` / `AGENT_HOME_PROJECT_MARKER` /
// `CEO_HOME_PROJECT_MARKER` in
// `apps/aura-os-server/src/handlers/agents/home_project.rs`. The
// description-prefix check matches the server's `description_is_auto_home`
// so a user-authored project literally named "Home" is NOT mistaken for
// the auto-home binding.
const AGENT_HOME_PROJECT_NAME = "Home";
const AGENT_HOME_DESCRIPTION_MARKERS = [
  "[aura:agent-home]",
  "[aura:ceo-home]",
];

function isAutoHomeProject(project: Project): boolean {
  if (project.name !== AGENT_HOME_PROJECT_NAME) return false;
  const description = project.description ?? "";
  return AGENT_HOME_DESCRIPTION_MARKERS.some((marker) =>
    description.startsWith(marker),
  );
}

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

  // Existing agents created before the auto-Home heal landed still
  // carry their original project binding (e.g. "zero-sdk-10") and have
  // no real Home project to switch to. We honor the persisted/legacy
  // selection as the chat-persistence target so historical sessions
  // remain reachable, but the picker label always reads "Home" in the
  // Agents app (see `displayProjects` below). The picker itself is
  // non-interactive going forward, so no NEW localStorage entries
  // are written — only legacy entries are read on mount.
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (!agentId) return undefined;
    return loadPersistedProject(agentId);
  });

  useEffect(() => {
    if (!agentId) return;
    setSelectedProjectId(loadPersistedProject(agentId));
  }, [agentId]);

  // The standalone Agents-app surfaces always render the project
  // picker as a single static "Home" label, no dropdown. The
  // project-scoped chat (`/projects/:projectId/agents/...`) is
  // unaffected; it uses its route project via `AgentChatPanel`, not
  // this hook.
  //
  // When the agent has a real auto-Home binding (matched by name +
  // `[aura:agent-home]` / `[aura:ceo-home]` description marker) we use
  // that project directly. Otherwise we keep using whichever project
  // `effectiveProjectId` resolves to for chat persistence but
  // synthesize a single-entry picker with `name: "Home"` so the Agents
  // app reads consistently. The server-side `home_project.rs` only
  // lazily creates the Home binding for agents that have *no* bindings
  // at all; agents bound to other projects pre-rollout never get a
  // Home row, which is why we relabel rather than try to surface the
  // real Home record.
  const homeProject = useMemo(
    () => agentProjects.find(isAutoHomeProject),
    [agentProjects],
  );

  const effectiveProjectId = useMemo(() => {
    if (homeProject) return homeProject.project_id;
    if (selectedProjectId && agentProjects.some((project) => project.project_id === selectedProjectId)) {
      return selectedProjectId;
    }
    return agentProjects[0]?.project_id;
  }, [homeProject, selectedProjectId, agentProjects]);

  const displayProjects = useMemo<Project[]>(() => {
    if (homeProject) return [homeProject];
    if (!effectiveProjectId) return EMPTY_PROJECTS;
    const baseProject = agentProjects.find(
      (project) => project.project_id === effectiveProjectId,
    );
    if (!baseProject) return EMPTY_PROJECTS;
    return [{ ...baseProject, name: AGENT_HOME_PROJECT_NAME }];
  }, [homeProject, effectiveProjectId, agentProjects]);

  // Tracks the optimistic placeholder id this hook inserted into the
  // SessionsList store on the most recent fresh-chat send. When
  // `SessionReady` lands, we swap the synthetic id for the real one
  // in place. See the matching ref in `AgentChatPanel`.
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
  // matching effect in `AgentChatPanel`.
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
  // `AgentChatPanel`; see that comment for the full rationale
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
    // `AgentChatPanel` which uses `api.listSessionEvents`. For
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
  // very next send. See the matching ref in `AgentChatPanel`.
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
  // wrapper in `AgentChatPanel`. Skips the projects-app
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
    projects: displayProjects,
    selectedProjectId: effectiveProjectId,
    onProjectChange: undefined,
    contextUsage,
    onNewSession: handleNewSession,
    onNewChat: handleNewChat,
  };
}
