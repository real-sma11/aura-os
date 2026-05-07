import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Modal } from "@cypher-asi/zui";
import { api } from "../../../../api/client";
import { useChatStream } from "../../../../hooks/use-chat-stream";
import { useChatHistorySync } from "../../../../hooks/use-chat-history-sync";
import { getIsStreaming, useStreamStore } from "../../../../hooks/stream/store";
import { useDelayedLoading } from "../../../../shared/hooks/use-delayed-loading";
import { useAgentChatMeta } from "../../../../hooks/use-agent-chat-meta";
import { useStandaloneAgentChat } from "../../../../hooks/use-standalone-agent-chat";
import { setLastAgent, setLastProject } from "../../../../utils/storage";
import { ChatPanel, type ChatPanelProps } from "../../../chat/components/ChatPanel";
import { MobileChatPanel } from "../../../../mobile/chat/MobileChatPanel";
import { MobileProjectAgentSwitcherSheet } from "../../../../mobile/chat/MobileProjectAgentSwitcherSheet";
import {
  agentHistoryKey,
  projectChatHistoryKey,
  useChatHistoryStore,
} from "../../../../stores/chat-history-store";
import {
  agentSessionsSurfaceKey,
  buildOptimisticSession,
  OPTIMISTIC_SESSION_ID_PREFIX,
  projectSessionsSurfaceKey,
  useAgentBindingsKey,
  useAgentBindingsLoadStatus,
  useMostRecentSession,
  useSessionsListStore,
} from "../../../../stores/sessions-list-store";
import { LAST_AGENT_ID_KEY } from "../../stores";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { queryClient } from "../../../../shared/lib/query-client";
import { deriveProjectAgentTitle } from "../../../../lib/derive-project-agent-title";
import { mergeAgentIntoProjectAgents, projectQueryKeys } from "../../../../queries/project-queries";
import { useChatHandoffStore } from "../../../../stores/chat-handoff-store";
import { useContextUsage, useContextUsageStore } from "../../../../stores/context-usage-store";
import { useHydrateContextUtilization } from "../../../../hooks/use-hydrate-context-utilization";
import {
  useDefaultProjectSessionRedirect,
  useDefaultStandaloneSessionRedirect,
} from "../../../../components/SessionsList/use-default-session-redirect";
import type { AgentInstance, Project } from "../../../../shared/types";
import {
  isCreateAgentChatHandoff,
  projectAgentHandoffTarget,
  standaloneAgentHandoffTarget,
} from "../../../../utils/chat-handoff";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useAgentBusy } from "../../../../hooks/use-agent-busy";
import styles from "./AgentChatView.module.css";

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_AGENT_INSTANCES: AgentInstance[] = [];
const EMPTY_SESSION_EVENTS_FETCH = () => Promise.resolve([]);

function selectCurrentProject(projectId: string) {
  return (state: { projects: Project[] }) => {
    const project = state.projects.find((candidate) => candidate.project_id === projectId);
    return project ? [project] : EMPTY_PROJECTS;
  };
}

function StandaloneAgentChatPanel({
  agentId,
  sessionId,
  freshCanvasPending = false,
  initialCreateHandoff,
  onInitialHandoffReady,
}: {
  agentId: string;
  sessionId: string | null;
  freshCanvasPending?: boolean;
  initialCreateHandoff: boolean;
  onInitialHandoffReady?: () => void;
}) {
  const sharedChatProps = useStandaloneAgentChat(agentId, sessionId, {
    freshCanvasPending,
  });
  const { isMobileLayout } = useAuraCapabilities();

  // Route-only side effect: keep the legacy "last agent" cookie used by
  // <MobileAgentDetailsView> and the agent rail in sync. The shared hook
  // already pushes the agentId into the agent store via `setSelectedAgent`,
  // so we only need to mirror it into localStorage here.
  useEffect(() => {
    try {
      localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
    } catch { /* ignore */ }
  }, [agentId]);

  const panelProps: ChatPanelProps = {
    ...sharedChatProps,
    initialHandoff: initialCreateHandoff ? "create-agent" : undefined,
    onInitialHandoffReady,
    scrollToBottomOnReset: false,
  };

  return isMobileLayout ? <MobileChatPanel {...panelProps} /> : <ChatPanel {...panelProps} />;
}

function ProjectAgentChatPanel({
  projectId,
  agentInstanceId,
  sessionId,
  initialCreateHandoff,
  onInitialHandoffReady,
}: {
  projectId: string;
  agentInstanceId: string;
  sessionId: string | null;
  initialCreateHandoff: boolean;
  onInitialHandoffReady?: () => void;
}) {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { isMobileLayout } = useAuraCapabilities();
  const currentProject = useProjectsListStore(useShallow(selectCurrentProject(projectId)));
  const projectName = currentProject[0]?.name ?? "";
  const projectAgents = useProjectsListStore((state) => state.agentsByProject[projectId] ?? EMPTY_AGENT_INSTANCES);
  const setAgentsByProject = useProjectsListStore((state) => state.setAgentsByProject);
  // The org-level `agent_id` for this `(project, instance)` pair. We
  // need it in `handleNewChat` to (a) clear the standalone agent's
  // history key and stream slot — the agents-shell resolver may swap
  // to `StandaloneAgentChatPanel` once `?session=` is dropped, and the
  // standalone panel keys its history off this id, not the
  // instance-scoped one. Resolved off the projects-list-store: a stable
  // string lookup that updates if the agent rebinds.
  const orgAgentId = useProjectsListStore(
    (state) =>
      state.agentsByProject[projectId]?.find(
        (agent) => agent.agent_instance_id === agentInstanceId,
      )?.agent_id ?? null,
  );

  // Tracks the optimistic placeholder id this panel inserted into
  // the SessionsList store on the most recent fresh-chat send. When
  // `SessionReady` lands, we swap the synthetic id for the
  // server-assigned one in place so the row keeps its position and
  // any in-flight Haiku summary stays attached to the same session.
  // Cleared after the swap; re-armed each time the user clicks `+`
  // and sends again.
  const pendingOptimisticIdRef = useRef<string | null>(null);

  // `?session=<id>` is the single source of truth for which session
  // this view is extending. When SessionReady arrives with a new id
  // (a fresh-canvas first-send creates one server-side), we mirror
  // it back into the URL via `setSearchParams({ replace: true })` so
  // the next mount of this view picks up where it left off and the
  // SessionsList's `selectedSessionId` highlight follows along.
  const handleSessionReady = useCallback(
    (newSessionId: string) => {
      setFreshChatNonce(0);
      const pendingOptimisticId = pendingOptimisticIdRef.current;
      if (pendingOptimisticId) {
        pendingOptimisticIdRef.current = null;
        const sessionsStore = useSessionsListStore.getState();
        const resolvedOrgAgentId = orgAgentIdRef.current;
        if (resolvedOrgAgentId) {
          sessionsStore.replaceSessionId(
            agentSessionsSurfaceKey(resolvedOrgAgentId),
            pendingOptimisticId,
            newSessionId,
          );
        }
        sessionsStore.replaceSessionId(
          projectSessionsSurfaceKey(projectId),
          pendingOptimisticId,
          newSessionId,
        );
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
    [projectId, setSearchParams],
  );

  const { streamKey, sendMessage, stopStreaming, resetEvents, markNextSendAsNewSession } =
    useChatStream({
      projectId,
      agentInstanceId,
      sessionId,
      onSessionReady: handleSessionReady,
    });
  const { agentName, machineType, templateAgentId, adapterType, defaultModel } = useAgentChatMeta(
    "project",
    { projectId, agentInstanceId },
  );
  const contextUsage = useContextUsage(streamKey);
  const [freshChatNonce, setFreshChatNonce] = useState(0);
  const freshCanvasPending = !sessionId && freshChatNonce > 0;

  useEffect(() => {
    if (sessionId) {
      setFreshChatNonce(0);
    }
  }, [sessionId]);

  // Clear the stream slot whenever the user navigates between two
  // historical sessions. Without this, switching from a session with N
  // events to a session with M events (where M <= N) leaves the old
  // session's events visible in the panel — `useChatHistorySync`'s
  // hydrate-to-stream effect skips the reset because of the
  // `streamCount >= historyMessages.length` guard (which exists to
  // avoid blinking the just-finished stream while history catches up
  // mid-turn).
  //
  // Only fire on a true cross-session navigation
  // (defined → different-defined). Three other transitions look like
  // session changes but must NOT wipe the stream:
  //   - `null → defined`: post-`SessionReady` URL flip after a
  //     fresh-canvas first send. The stream holds the live events
  //     for that turn; clearing here would erase the optimistic user
  //     bubble that `sendMessage` just added.
  //   - `defined → null`: clicking "+" already calls `resetEvents`
  //     directly inside `handleNewChat`, so the effect is redundant
  //     here and only adds an extra clear that races with the send.
  //   - any flip while a turn is actively streaming: the SSE is the
  //     source of truth, never let a URL change clobber it.
  const prevSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    const previous = prevSessionIdRef.current;
    prevSessionIdRef.current = sessionId;
    if (previous === sessionId) return;
    if (previous === null || sessionId === null) return;
    if (getIsStreaming(streamKey)) return;
    resetEvents([], { allowWhileStreaming: true });
  }, [sessionId, resetEvents, streamKey]);

  // Default-select the most recent session by `started_at` when the
  // URL has no `?session=` (see `useDefaultProjectSessionRedirect`).
  // Now that session views are editable, the redirect is just "open
  // your most recent thread" — equivalent to ChatGPT picking up your
  // last chat on cold open.
  useDefaultProjectSessionRedirect({
    projectId,
    agentInstanceId,
    sessionId,
    setSearchParams,
  });

  const historyKey = useMemo(() => {
    if (freshCanvasPending) {
      return `fresh:${projectId}:${agentInstanceId}:${freshChatNonce}`;
    }
    if (sessionId) {
      return `session:${projectId}:${agentInstanceId}:${sessionId}`;
    }
    return projectChatHistoryKey(projectId, agentInstanceId);
  }, [agentInstanceId, freshCanvasPending, freshChatNonce, projectId, sessionId]);

  const fetchFn = useMemo(() => {
    if (freshCanvasPending) {
      return EMPTY_SESSION_EVENTS_FETCH;
    }
    if (sessionId) {
      return () => api.listSessionEvents(projectId, agentInstanceId, sessionId);
    }
    return () => api.getEvents(projectId, agentInstanceId);
  }, [agentInstanceId, freshCanvasPending, projectId, sessionId]);

  const onProjectSwitch = useCallback(() => {
    setLastProject(projectId);
    setLastAgent(projectId, agentInstanceId);
  }, [agentInstanceId, projectId]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  // `markNextSendAsNewSession` is returned as a fresh inline lambda from
  // `useChatStream` on every render — keep a ref so the new-session /
  // new-chat callbacks don't get a fresh identity on every parent
  // re-render and can stay memoized across session switches.
  const markNextSendAsNewSessionRef = useRef(markNextSendAsNewSession);
  useEffect(() => {
    markNextSendAsNewSessionRef.current = markNextSendAsNewSession;
  }, [markNextSendAsNewSession]);

  // `historyKey` flips between `project:...` and `session:...:<id>` whenever
  // the URL `?session=` changes. Reading it via a ref keeps `handleNewChat`'s
  // identity stable across session navigation so the chat input bar's
  // `onNewChat` prop doesn't churn.
  const historyKeyRef = useRef(historyKey);
  useEffect(() => {
    historyKeyRef.current = historyKey;
  }, [historyKey]);

  // Mirror `orgAgentId` via a ref for the same reason: the value
  // resolves asynchronously off `projectsByAgent` and would otherwise
  // ride along in `handleNewChat`'s deps and churn its identity every
  // time the projects store mutated. The chat input bar's `onNewChat`
  // is `React.memo`-compared, so a stable identity matters.
  const orgAgentIdRef = useRef(orgAgentId);
  useEffect(() => {
    orgAgentIdRef.current = orgAgentId;
  }, [orgAgentId]);

  const handleNewSession = useCallback(() => {
    void import("../../../../lib/analytics").then(({ track }) => track("chat_session_reset"));
    markNextSendAsNewSessionRef.current();
    useChatHistoryStore.getState().clearHistory(historyKeyRef.current);
    setFreshChatNonce((nonce) => nonce + 1);
    resetEvents([], { allowWhileStreaming: true });
    const store = useContextUsageStore.getState();
    store.clearContextUtilization(streamKey);
    store.markResetPending(streamKey);
    // Drop `?session=` so the next render is a fresh canvas. The
    // server creates a new session on the next send (driven by
    // `markNextSendAsNewSession`), and `handleSessionReady` writes
    // the fresh id back into the URL.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("session");
        return next;
      },
      { replace: true },
    );
  }, [streamKey, resetEvents, setSearchParams]);

  // Tracks whether the most recent user action armed a new-session
  // send. Set in `handleNewChat`, consumed inside the `wrappedSend`
  // wrapper to decide whether to insert an optimistic placeholder
  // row into the SessionsList store. Mirrors `markNextSendAsNewSession`
  // on the chat-stream side, but kept locally so we can react to the
  // very first send without poking into `useChatStream`'s internals.
  const pendingOptimisticArmedRef = useRef(false);

  const handleNewChat = useCallback(() => {
    void import("../../../../lib/analytics").then(({ track }) => track("chat_new_chat"));
    markNextSendAsNewSessionRef.current();
    pendingOptimisticArmedRef.current = true;
    // Blank the visible transcript immediately. The chat-history-store
    // entry is dropped (and the IDB cache for the *old* historyKey is
    // wiped); the local stream buffer is replaced with []. The next
    // SessionReady writes the fresh session id back into `?session=`
    // via `handleSessionReady` so the panel keeps streaming into a
    // clean session-scoped slot.
    useChatHistoryStore.getState().clearHistory(historyKeyRef.current);
    // Also clear destination history keys so the fresh canvas can't
    // pull stale events back in. The project no-session key is the
    // normal agents-shell `+` destination; the standalone key remains
    // a defensive clear for routes that do not carry project/instance.
    //   1. `projectChatHistoryKey(projectId, agentInstanceId)` —
    //      `ProjectAgentChatPanel`'s no-session `historyKey`. On the
    //      bare `/projects/.../agents/...` route this is the key the
    //      panel's next render reads from.
    //   2. `agentHistoryKey(orgAgentId)` — `StandaloneAgentChatPanel`'s
    //      `historyKey` for fresh standalone-agent routes.
    const historyStore = useChatHistoryStore.getState();
    historyStore.clearHistory(projectChatHistoryKey(projectId, agentInstanceId));
    const resolvedOrgAgentId = orgAgentIdRef.current;
    if (resolvedOrgAgentId) {
      historyStore.clearHistory(agentHistoryKey(resolvedOrgAgentId));
      // Wipe the standalone stream slot too, for routes that really do
      // fall back to the standalone fresh-canvas panel.
      const standaloneStreamKey = resolvedOrgAgentId;
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
    useSessionsListStore.getState().bumpVersion();
  }, [streamKey, resetEvents, setSearchParams, projectId, agentInstanceId]);

  const contextUsageFetcher = useMemo(() => {
    return (signal: AbortSignal) =>
      api.getContextUsage(projectId, agentInstanceId, { signal });
  }, [projectId, agentInstanceId]);
  useHydrateContextUtilization(
    streamKey,
    contextUsageFetcher,
    agentInstanceId,
  );

  const { historyMessages, historyResolved, isLoading, historyError, wrapSend } = useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    suppressHistoryFetch: freshCanvasPending,
    // Pinned-session views need to invalidate the cache before
    // refetching so a stale `live-session:` snapshot from before
    // this refactor (or one written by another tab) doesn't block
    // the fresh fetch.
    invalidateBeforeFetch: !!sessionId,
    onSwitch: onProjectSwitch,
    onClear,
    watchAgentInstanceId: agentInstanceId,
    watchSessionId: sessionId ?? undefined,
    projectIdForSidekick: projectId,
  });

  const hasHistory = historyMessages.length > 0;
  const renameTriggeredRef = useRef(false);
  useEffect(() => {
    renameTriggeredRef.current = false;
  }, [agentInstanceId, sessionId]);

  const wrappedSendBase = useMemo(() => wrapSend(sendMessage), [wrapSend, sendMessage]);
  // Mirror every value `maybeRenameFromFirstPrompt` reads via a ref so the
  // callback's identity stays stable. The original `useCallback` deps
  // included `sessionId`, `hasHistory`, and `agentName`, all of which flip
  // whenever the user navigates between sessions or right after a rename
  // succeeds — that propagated into `wrappedSend` and clobbered the
  // input bar's `React.memo` shallow compare.
  const renameContextRef = useRef({
    agentInstanceId,
    agentName,
    hasHistory,
    sessionId,
    projectId,
    setAgentsByProject,
  });
  useEffect(() => {
    renameContextRef.current = {
      agentInstanceId,
      agentName,
      hasHistory,
      sessionId,
      projectId,
      setAgentsByProject,
    };
  }, [agentInstanceId, agentName, hasHistory, sessionId, projectId, setAgentsByProject]);
  const maybeRenameFromFirstPrompt = useCallback((content: string) => {
    const ctx = renameContextRef.current;
    // Auto-rename the agent from its first prompt only when the user
    // is on a fresh canvas (no `?session=`) and no history has loaded
    // yet. Continuing an existing session keeps the original name.
    if (renameTriggeredRef.current || ctx.sessionId || ctx.agentName !== "New Agent") {
      return;
    }
    if (ctx.hasHistory) {
      return;
    }

    const nextName = deriveProjectAgentTitle(content);
    if (!nextName || nextName === "New Agent") {
      return;
    }

    renameTriggeredRef.current = true;
    void api.updateAgentInstance(ctx.projectId, ctx.agentInstanceId, { name: nextName })
      .then((updated) => {
        queryClient.setQueryData(
          projectQueryKeys.agentInstance(ctx.projectId, ctx.agentInstanceId),
          updated,
        );
        ctx.setAgentsByProject((prev) => ({
          ...prev,
          [ctx.projectId]: mergeAgentIntoProjectAgents(prev[ctx.projectId], updated),
        }));
      })
      .catch((error) => {
        renameTriggeredRef.current = false;
        console.error("Failed to rename project agent from first prompt", error);
      });
  }, []);
  // Mirror the project-name lookup via a ref so the optimistic-insert
  // path doesn't churn `wrappedSend`'s identity every time the projects
  // store mutates. The chat input bar's `onSend` is `React.memo`-compared
  // and a fresh function on every projects-store flip would defeat that.
  const projectNameRef = useRef(projectName);
  useEffect(() => { projectNameRef.current = projectName; }, [projectName]);
  // Insert an optimistic "New chat" row into the SessionsList store the
  // first time the user sends after pressing `+`. The row is keyed by
  // a synthetic `optimistic:<uuid>` id and preserved across concurrent
  // `loadAgentSessions` / `loadProjectSessions` refreshes (see
  // `preserveOptimisticRows` in `sessions-list-store`). When
  // `SessionReady` arrives, `handleSessionReady` swaps the synthetic id
  // for the real session_id in place. Without this, the sidekick has
  // no row at all between "Send" and the SSE round-trip + refetch.
  const insertOptimisticSessionRow = useCallback((): string => {
    const optimisticId =
      `${OPTIMISTIC_SESSION_ID_PREFIX}${typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
    const optimisticSession = buildOptimisticSession({
      optimisticId,
      projectId,
      projectName: projectNameRef.current,
      agentInstanceId,
    });
    const sessionsStore = useSessionsListStore.getState();
    const resolvedOrgAgentId = orgAgentIdRef.current;
    if (resolvedOrgAgentId) {
      sessionsStore.addOptimisticSession(
        agentSessionsSurfaceKey(resolvedOrgAgentId),
        optimisticSession,
      );
    }
    sessionsStore.addOptimisticSession(
      projectSessionsSurfaceKey(projectId),
      optimisticSession,
    );
    return optimisticId;
  }, [agentInstanceId, projectId]);
  const wrappedSend = useCallback((...args: Parameters<typeof wrappedSendBase>) => {
    if (pendingOptimisticArmedRef.current) {
      pendingOptimisticArmedRef.current = false;
      pendingOptimisticIdRef.current = insertOptimisticSessionRow();
    }
    maybeRenameFromFirstPrompt(args[0] ?? "");
    return wrappedSendBase(...args);
  }, [insertOptimisticSessionRow, maybeRenameFromFirstPrompt, wrappedSendBase]);

  // Combine our own chat-SSE streaming state with automation-loop
  // activity against the same upstream agent so the chat input shows
  // the stop icon (and blocks Send) whenever the harness would reject
  // a new turn. The harness enforces one in-flight turn per agent id
  // upstream — see `/v1/agents/{id}/sessions` vs
  // `/v1/agents/{id}/automaton/start` in the server.
  const busy = useAgentBusy({ projectId, agentInstanceId, streamKey });
  const loopOnlyBusy = busy.isBusy && busy.reason === "loop";
  // `loopOnlyBusy` flips per turn — keep the read behind a ref so
  // `handleCombinedStop`'s identity stays stable per agent. Without this
  // the chat input bar's `onStop` prop changed on every stream toggle and
  // its `React.memo` couldn't skip on session navigation.
  const loopOnlyBusyRef = useRef(loopOnlyBusy);
  useEffect(() => {
    loopOnlyBusyRef.current = loopOnlyBusy;
  }, [loopOnlyBusy]);
  const handleCombinedStop = useCallback(() => {
    if (loopOnlyBusyRef.current) {
      void api.stopLoop(projectId, agentInstanceId).catch((err) => {
        console.error("Failed to stop automation loop from chat", err);
      });
      return;
    }
    stopStreaming();
  }, [projectId, agentInstanceId, stopStreaming]);

  const deferredLoading = useDelayedLoading(isLoading);
  const panelKey = sessionId
    ? `${agentInstanceId}:${sessionId}`
    : freshCanvasPending
      ? `${agentInstanceId}:fresh:${freshChatNonce}`
      : agentInstanceId;
  const shouldUseCreateHandoff = initialCreateHandoff && !sessionId;
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const showAgentSwitcher = projectAgents.length > 1;
  const mobileHeaderSummaryHint = agentName ? (showAgentSwitcher ? `${projectAgents.length} agents in project` : machineType === "remote"
    ? "Remote"
    : "Local") : undefined;
  const openAgentPicker = useCallback(() => {
    setAgentPickerOpen(true);
  }, []);
  const closeAgentPicker = useCallback(() => {
    setAgentPickerOpen(false);
  }, []);
  const switchProjectAgent = useCallback((nextAgentInstanceId: string) => {
    setAgentPickerOpen(false);
    setLastProject(projectId);
    setLastAgent(projectId, nextAgentInstanceId);
    navigate(`/projects/${projectId}/agents/${nextAgentInstanceId}`);
  }, [navigate, projectId]);
  const agentPickerContent = (
    <div className={styles.agentSwitcherBody}>
      <div className={styles.agentSwitcherHeader}>
        <span className={styles.agentSwitcherName}>Project agents</span>
        <span className={styles.agentSwitcherMeta}>Switch who you are chatting with.</span>
      </div>
      <div className={styles.agentSwitcherList}>
        {projectAgents.map((agent) => {
          const isCurrentAgent = agent.agent_instance_id === agentInstanceId;
          return (
            <button
              key={agent.agent_instance_id}
              type="button"
              className={`${styles.agentSwitcherRow} ${isCurrentAgent ? styles.agentSwitcherRowCurrent : ""}`}
              onClick={() => {
                if (isCurrentAgent) {
                  return;
                }
                switchProjectAgent(agent.agent_instance_id);
              }}
              aria-label={isCurrentAgent ? `${agent.name}, current agent` : `Switch to ${agent.name}`}
              disabled={isCurrentAgent}
            >
              <span className={styles.agentSwitcherCopy}>
                <span className={styles.agentSwitcherName}>{agent.name}</span>
                <span className={styles.agentSwitcherMeta}>{agent.role?.trim() || "Remote AURA agent"}</span>
              </span>
              {isCurrentAgent ? <span className={styles.agentSwitcherStatus}>Current</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
  const panelProps: ChatPanelProps = {
    streamKey,
    transcriptKey: historyKey,
    onSend: wrappedSend,
    onStop: handleCombinedStop,
    isExternallyBusy: loopOnlyBusy,
    externalBusyMessage: loopOnlyBusy
      ? "This agent is running an automation task. Stop it to chat."
      : undefined,
    agentName,
    machineType,
    templateAgentId,
    adapterType,
    defaultModel,
    agentId: agentInstanceId,
    isLoading: deferredLoading,
    historyResolved,
    errorMessage: historyError ? historyError : null,
    initialHandoff: shouldUseCreateHandoff ? "create-agent" : undefined,
    onInitialHandoffReady,
    scrollResetKey: panelKey,
    historyMessages,
    projects: currentProject,
    selectedProjectId: projectId,
    contextUsage,
    onNewSession: handleNewSession,
    onNewChat: handleNewChat,
  };

  return (
    <>
      {isMobileLayout ? (
        <MobileChatPanel
          {...panelProps}
          onMobileHeaderSummaryClick={showAgentSwitcher ? openAgentPicker : undefined}
          mobileHeaderSummaryHint={mobileHeaderSummaryHint}
          mobileHeaderSummaryLabel="Switch project agent"
          mobileHeaderSummaryKind={showAgentSwitcher ? "switch" : "details"}
        />
      ) : (
        <ChatPanel {...panelProps} />
      )}
      {agentPickerOpen
        ? (isMobileLayout ? (
          <MobileProjectAgentSwitcherSheet
            isOpen
            agents={projectAgents}
            currentAgentInstanceId={agentInstanceId}
            onClose={closeAgentPicker}
            onSwitchAgent={switchProjectAgent}
          />
        ) : (
          <Modal
            isOpen
            onClose={closeAgentPicker}
            title="Switch agent"
            size="sm"
          >
            {agentPickerContent}
          </Modal>
        ))
        : null}
    </>
  );
}

type AgentsShellTarget =
  | { kind: "pending" }
  | {
      kind: "project";
      projectId: string;
      agentInstanceId: string;
      sessionId: string | null;
    }
  | { kind: "standalone"; freshCanvasPending?: boolean };

function sessionHistoryKey(
  projectId: string,
  agentInstanceId: string,
  sessionId: string,
): string {
  return `session:${projectId}:${agentInstanceId}:${sessionId}`;
}

/**
 * Resolves what the agents-shell `/agents/:agentId` URL should render
 * once the user clicks an agent in the sidebar. Two flicker sources
 * collapse into one decision tree here:
 *
 * 1. The URL transit window. `useDefaultStandaloneSessionRedirect`
 *    pushes `?project=&instance=&session=` from a `useEffect`, so
 *    there's always at least one render with the bare URL after a
 *    click. Without intervention `AgentChatView` would mount
 *    `StandaloneAgentChatPanel` in that gap and fire its per-agent
 *    timeline fetch, then unmount it as soon as the redirect lands.
 *    We return `pending` while the redirect is imminent so the
 *    standalone panel never mounts in the transient state.
 *
 * 2. The session-events cold load. We eagerly call
 *    `chat-history-store.fetchHistory` for the resolved session as
 *    soon as we know it (URL or `mostRecent`), but still mount
 *    `ProjectAgentChatPanel` immediately so its input and lifecycle
 *    refs survive warm/cold session switches. The panel owns its own
 *    loading overlay and stream reset.
 *
 * `standalone` is reserved for the genuine "agent has no sessions
 * yet" case (no bindings, or sessions loaded empty). The standalone
 * panel still owns that flow: there's no per-session events to wait
 * on, so dropping straight into the fresh-canvas chat is correct.
 */
function useAgentsShellTarget(opts: {
  agentId: string | undefined;
  hasProjectPathParams: boolean;
  queryProjectId: string | null;
  queryInstanceId: string | null;
  sessionId: string | null;
}): AgentsShellTarget {
  const {
    agentId,
    hasProjectPathParams,
    queryProjectId,
    queryInstanceId,
    sessionId,
  } = opts;

  const standaloneSurfaceKey = agentId ? agentSessionsSurfaceKey(agentId) : undefined;
  const mostRecent = useMostRecentSession(standaloneSurfaceKey);
  const bindingsKey = useAgentBindingsKey(agentId);
  const bindingsLoadStatus = useAgentBindingsLoadStatus(agentId);

  const sessionsKnown = useSessionsListStore((state) => {
    if (!standaloneSurfaceKey) return false;
    return state.sessionsBySurface[standaloneSurfaceKey] !== undefined;
  });

  // Latches `true` once the URL has carried a `?session=` for the
  // current agent. Reset on agent change. Used to distinguish "cold
  // load with no session" (default-redirect imminent → keep the
  // pending state) from "user clicked + to start a fresh chat"
  // (URL just dropped its session → mount the standalone panel for a
  // fresh canvas instead of falling back to most-recent, which would
  // otherwise lock the lane on a `lanePlaceholder` div forever:
  // `useDefaultStandaloneSessionRedirect`'s `didDefaultRef` is already
  // stamped, so no redirect re-fires to put a session back in the URL).
  const visitedSessionRef = useRef(Boolean(sessionId));
  const prevAgentRef = useRef(agentId);
  if (prevAgentRef.current !== agentId) {
    prevAgentRef.current = agentId;
    visitedSessionRef.current = Boolean(sessionId);
  } else if (sessionId) {
    visitedSessionRef.current = true;
  }
  const userClearedSession = !sessionId && visitedSessionRef.current;

  const urlTarget = (queryProjectId && queryInstanceId && sessionId)
    ? {
        projectId: queryProjectId,
        agentInstanceId: queryInstanceId,
        sessionId,
      }
    : null;

  const fallbackTarget = (!urlTarget && agentId && !hasProjectPathParams && mostRecent)
    ? {
        projectId: mostRecent._projectId,
        agentInstanceId: mostRecent._agentInstanceId,
        sessionId: mostRecent.session_id,
      }
    : null;

  const resolvedTarget = urlTarget ?? fallbackTarget;
  const resolvedHistoryKey = resolvedTarget
    && resolvedTarget.sessionId
    ? sessionHistoryKey(
        resolvedTarget.projectId,
        resolvedTarget.agentInstanceId,
        resolvedTarget.sessionId,
      )
    : null;

  // Eagerly warm `chat-history-store` for the resolved session so
  // warm switches can reveal immediately inside `ProjectAgentChatPanel`.
  // Keyed off the historyKey so re-resolving to the same session
  // doesn't re-fire the fetch (the store TTL would short-circuit it
  // anyway, but skipping the no-op call is cheaper).
  const targetProjectId = resolvedTarget?.projectId;
  const targetAgentInstanceId = resolvedTarget?.agentInstanceId;
  const targetSessionId = resolvedTarget?.sessionId;
  useEffect(() => {
    if (!resolvedHistoryKey) return;
    if (!targetProjectId || !targetAgentInstanceId || !targetSessionId) return;
    void useChatHistoryStore.getState().fetchHistory(
      resolvedHistoryKey,
      () => api.listSessionEvents(targetProjectId, targetAgentInstanceId, targetSessionId),
    );
  }, [resolvedHistoryKey, targetProjectId, targetAgentInstanceId, targetSessionId]);

  // 1. URL already carries a session pointer (session-row click, or
  //    the redirect just landed). Mount the project panel immediately
  //    and let its in-panel cold-load handling own event readiness.
  if (urlTarget) {
    return { kind: "project", ...urlTarget };
  }

  // 2. The user clicked "+" in the chat input bar — `handleNewChat`
  //    dropped only `?session=` with the explicit intent of starting a
  //    fresh chat in the same `(project, instance)`. Keep the project
  //    panel mounted with `sessionId: null` so the stream hook that was
  //    just armed with `new_session: true` is the one that handles the
  //    first send. Once SessionReady writes the new id back into the URL,
  //    this same branch becomes the normal URL-session branch above.
  if (userClearedSession) {
    if (queryProjectId && queryInstanceId) {
      return {
        kind: "project",
        projectId: queryProjectId,
        agentInstanceId: queryInstanceId,
        sessionId: null,
      };
    }
    return { kind: "standalone", freshCanvasPending: true };
  }

  // 3. No URL session yet but `mostRecent` is known — render the
  //    project panel for that concrete target while the redirect hook
  //    settles the URL.
  if (fallbackTarget) {
    return { kind: "project", ...fallbackTarget };
  }

  if (!agentId) return { kind: "standalone" };

  // 4. Bindings haven't been fetched (or are still in flight). The
  //    server-authoritative `listProjectBindings` call inside
  //    `loadAgentSessions` may still surface a Home / cross-org binding
  //    that the active-org sidebar doesn't expose, so we *cannot*
  //    short-circuit to the standalone view yet — it would flash the
  //    fresh-canvas panel for an agent that actually has prior chats.
  if (
    bindingsLoadStatus === "idle" ||
    bindingsLoadStatus === "loading"
  ) {
    return { kind: "pending" };
  }

  // 5. Server confirmed the agent has zero bindings (lazy-repair
  //    failure or template orphan). Fall through to the fresh-canvas
  //    standalone view; sending a message will trigger another
  //    repair attempt server-side.
  if (!bindingsKey) return { kind: "standalone" };

  // 6. Bindings exist but the sessions surface hasn't reported back
  //    yet — `loadAgentSessions` is in flight. A redirect *may*
  //    follow once the response lands, so defer to avoid a flash of
  //    the standalone panel.
  if (!sessionsKnown) return { kind: "pending" };

  // 7. Sessions loaded empty → no redirect possible, mount the
  //    standalone panel for the fresh-canvas first chat.
  return { kind: "standalone" };
}

export function AgentChatView() {
  const { projectId, agentInstanceId, agentId } = useParams<{
    projectId: string;
    agentInstanceId: string;
    agentId: string;
  }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  // Agents-app historical-session branch: when ChatsTab is opened
  // from inside the agents shell it routes to
  // `/agents/:agentId?project=...&instance=...&session=...` so the
  // user stays on `/agents/...` (and the agents sidekick stays
  // mounted). Fetching session events still requires
  // `(projectId, agentInstanceId, sessionId)` since
  // `api.listSessionEvents` is the only per-session fetch we have.
  const queryProjectId = searchParams.get("project");
  const queryInstanceId = searchParams.get("instance");
  const isCreateHandoff = isCreateAgentChatHandoff(location.state);
  const completeCreateAgentHandoff = useChatHandoffStore((state) => state.completeCreateAgentHandoff);

  // Standalone-agent default-session redirect: when the user lands
  // on `/agents/:agentId` with no `?session=`, replace the URL with
  // the most-recent session across the agent's bindings. The session
  // view is now editable, so this is the same "open your last chat"
  // behavior ChatGPT ships with.
  useDefaultStandaloneSessionRedirect({
    agentId,
    sessionId,
    setSearchParams,
    disabled: Boolean(projectId),
  });

  const agentsShellTarget = useAgentsShellTarget({
    agentId,
    hasProjectPathParams: Boolean(projectId && agentInstanceId),
    queryProjectId,
    queryInstanceId,
    sessionId,
  });

  const handleProjectHandoffReady = useCallback(() => {
    if (!projectId || !agentInstanceId) {
      return;
    }
    completeCreateAgentHandoff(projectAgentHandoffTarget(projectId, agentInstanceId));
  }, [agentInstanceId, completeCreateAgentHandoff, projectId]);

  const handleStandaloneHandoffReady = useCallback(() => {
    if (!agentId) {
      return;
    }
    completeCreateAgentHandoff(standaloneAgentHandoffTarget(agentId));
  }, [agentId, completeCreateAgentHandoff]);

  if (projectId && agentInstanceId) {
    return (
      <ProjectAgentChatPanel
        projectId={projectId}
        agentInstanceId={agentInstanceId}
        sessionId={sessionId}
        initialCreateHandoff={isCreateHandoff}
        onInitialHandoffReady={isCreateHandoff ? handleProjectHandoffReady : undefined}
      />
    );
  }

  // Agents-shell flow: render based on the resolved target. The
  // resolver suppresses the transient `StandaloneAgentChatPanel`
  // mount only while the target session is unknown. Once it resolves,
  // `ProjectAgentChatPanel` stays mounted and owns loading/reset
  // behavior. See `useAgentsShellTarget` for the full decision tree.
  if (agentId && agentsShellTarget.kind === "pending") {
    return <div className={styles.lanePlaceholder} aria-hidden="true" />;
  }

  if (agentId && agentsShellTarget.kind === "project") {
    // Agents-shell session branch: URL carries `?project=&instance=&session=`
    // (either from a session-row click or from the default-session redirect).
    // Forwarded pointers feed `ProjectAgentChatPanel` so the per-session
    // history fetch and editable send wiring kick in without leaving the
    // agents app shell.
    return (
      <ProjectAgentChatPanel
        projectId={agentsShellTarget.projectId}
        agentInstanceId={agentsShellTarget.agentInstanceId}
        sessionId={agentsShellTarget.sessionId}
        initialCreateHandoff={false}
      />
    );
  }

  if (agentId && agentsShellTarget.kind === "standalone") {
    return (
      <StandaloneAgentChatPanel
        agentId={agentId}
        sessionId={sessionId}
        freshCanvasPending={agentsShellTarget.freshCanvasPending}
        initialCreateHandoff={isCreateHandoff}
        onInitialHandoffReady={isCreateHandoff ? handleStandaloneHandoffReady : undefined}
      />
    );
  }

  return null;
}
