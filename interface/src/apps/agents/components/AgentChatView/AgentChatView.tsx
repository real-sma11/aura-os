import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Modal } from "@cypher-asi/zui";
import { api } from "../../../../api/client";
import { useChatStream } from "../../../../hooks/use-chat-stream";
import { useChatHistorySync } from "../../../../hooks/use-chat-history-sync";
import { useDelayedLoading } from "../../../../shared/hooks/use-delayed-loading";
import { useAgentChatMeta } from "../../../../hooks/use-agent-chat-meta";
import { useStandaloneAgentChat } from "../../../../hooks/use-standalone-agent-chat";
import { setLastAgent, setLastProject } from "../../../../utils/storage";
import { ChatPanel, type ChatPanelProps } from "../../../chat/components/ChatPanel";
import { MobileChatPanel } from "../../../../mobile/chat/MobileChatPanel";
import { MobileProjectAgentSwitcherSheet } from "../../../../mobile/chat/MobileProjectAgentSwitcherSheet";
import {
  projectChatHistoryKey,
  useChatHistoryStore,
} from "../../../../stores/chat-history-store";
import { useSessionsListStore } from "../../../../stores/sessions-list-store";
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

function selectCurrentProject(projectId: string) {
  return (state: { projects: Project[] }) => {
    const project = state.projects.find((candidate) => candidate.project_id === projectId);
    return project ? [project] : EMPTY_PROJECTS;
  };
}

function StandaloneAgentChatPanel({
  agentId,
  sessionId,
  initialCreateHandoff,
  onInitialHandoffReady,
}: {
  agentId: string;
  sessionId: string | null;
  initialCreateHandoff: boolean;
  onInitialHandoffReady?: () => void;
}) {
  const sharedChatProps = useStandaloneAgentChat(agentId, sessionId);
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
  const projectAgents = useProjectsListStore((state) => state.agentsByProject[projectId] ?? EMPTY_AGENT_INSTANCES);
  const setAgentsByProject = useProjectsListStore((state) => state.setAgentsByProject);

  // `?session=<id>` is the single source of truth for which session
  // this view is extending. When SessionReady arrives with a new id
  // (a fresh-canvas first-send creates one server-side), we mirror
  // it back into the URL via `setSearchParams({ replace: true })` so
  // the next mount of this view picks up where it left off and the
  // SessionsList's `selectedSessionId` highlight follows along.
  const handleSessionReady = useCallback(
    (newSessionId: string) => {
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

  // Clear the stream slot whenever the user navigates between
  // sessions. Without this, switching from a session with N events
  // to a session with M events (where M <= N) leaves the old
  // session's events visible in the panel — `useChatHistorySync`'s
  // hydrate-to-stream effect skips the reset because of the
  // `streamCount >= historyMessages.length` guard (which exists to
  // avoid blinking the just-finished stream while history catches up
  // mid-turn).
  //
  // The null → defined transition is excluded: that's the
  // mid-turn `SessionReady` flow where the user clicked "+", sent a
  // message, and the server assigned a new id. The stream already
  // holds the live events for that turn, and clearing here would
  // wipe them.
  const prevSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    const previous = prevSessionIdRef.current;
    prevSessionIdRef.current = sessionId;
    if (previous === sessionId) return;
    if (previous === null && sessionId !== null) return;
    resetEvents([], { allowWhileStreaming: true });
  }, [sessionId, resetEvents]);

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
    if (sessionId) {
      return `session:${projectId}:${agentInstanceId}:${sessionId}`;
    }
    return projectChatHistoryKey(projectId, agentInstanceId);
  }, [agentInstanceId, projectId, sessionId]);

  const fetchFn = useMemo(() => {
    if (sessionId) {
      return () => api.listSessionEvents(projectId, agentInstanceId, sessionId);
    }
    return () => api.getEvents(projectId, agentInstanceId);
  }, [agentInstanceId, projectId, sessionId]);

  const onProjectSwitch = useCallback(() => {
    setLastProject(projectId);
    setLastAgent(projectId, agentInstanceId);
  }, [agentInstanceId, projectId]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const handleNewSession = useCallback(() => {
    void import("../../../../lib/analytics").then(({ track }) => track("chat_session_reset"));
    markNextSendAsNewSession();
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
  }, [markNextSendAsNewSession, streamKey, setSearchParams]);

  const handleNewChat = useCallback(() => {
    void import("../../../../lib/analytics").then(({ track }) => track("chat_new_chat"));
    markNextSendAsNewSession();
    // Blank the visible transcript immediately. The chat-history-store
    // entry is dropped (and the IDB cache for the *old* historyKey is
    // wiped); the local stream buffer is replaced with []. The next
    // SessionReady writes the fresh session id back into `?session=`
    // via `handleSessionReady` so the panel keeps streaming into a
    // clean session-scoped slot.
    useChatHistoryStore.getState().clearHistory(historyKey);
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
    // Optimistic refresh; the real new session row arrives after the
    // user's first send (the chat stream bumps again on `SessionReady`).
    useSessionsListStore.getState().bumpVersion();
  }, [
    markNextSendAsNewSession,
    streamKey,
    historyKey,
    resetEvents,
    setSearchParams,
  ]);

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
  const maybeRenameFromFirstPrompt = useCallback((content: string) => {
    // Auto-rename the agent from its first prompt only when the user
    // is on a fresh canvas (no `?session=`) and no history has loaded
    // yet. Continuing an existing session keeps the original name.
    if (renameTriggeredRef.current || sessionId || agentName !== "New Agent") {
      return;
    }
    if (hasHistory) {
      return;
    }

    const nextName = deriveProjectAgentTitle(content);
    if (!nextName || nextName === "New Agent") {
      return;
    }

    renameTriggeredRef.current = true;
    void api.updateAgentInstance(projectId, agentInstanceId, { name: nextName })
      .then((updated) => {
        queryClient.setQueryData(
          projectQueryKeys.agentInstance(projectId, agentInstanceId),
          updated,
        );
        setAgentsByProject((prev) => ({
          ...prev,
          [projectId]: mergeAgentIntoProjectAgents(prev[projectId], updated),
        }));
      })
      .catch((error) => {
        renameTriggeredRef.current = false;
        console.error("Failed to rename project agent from first prompt", error);
      });
  }, [
    agentInstanceId,
    agentName,
    hasHistory,
    sessionId,
    projectId,
    setAgentsByProject,
  ]);
  const wrappedSend = useCallback((...args: Parameters<typeof wrappedSendBase>) => {
    maybeRenameFromFirstPrompt(args[0] ?? "");
    return wrappedSendBase(...args);
  }, [maybeRenameFromFirstPrompt, wrappedSendBase]);

  // Combine our own chat-SSE streaming state with automation-loop
  // activity against the same upstream agent so the chat input shows
  // the stop icon (and blocks Send) whenever the harness would reject
  // a new turn. The harness enforces one in-flight turn per agent id
  // upstream — see `/v1/agents/{id}/sessions` vs
  // `/v1/agents/{id}/automaton/start` in the server.
  const busy = useAgentBusy({ projectId, agentInstanceId, streamKey });
  const loopOnlyBusy = busy.isBusy && busy.reason === "loop";
  const handleCombinedStop = useCallback(() => {
    if (loopOnlyBusy) {
      void api.stopLoop(projectId, agentInstanceId).catch((err) => {
        console.error("Failed to stop automation loop from chat", err);
      });
      return;
    }
    stopStreaming();
  }, [loopOnlyBusy, projectId, agentInstanceId, stopStreaming]);

  const deferredLoading = useDelayedLoading(isLoading);
  const panelKey = sessionId ? `${agentInstanceId}:${sessionId}` : agentInstanceId;
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

  if (agentId && queryProjectId && queryInstanceId && sessionId) {
    // Agents-app session branch: when ChatsTab routes a session
    // click while the user is inside the agents shell, the URL
    // becomes `/agents/:agentId?project=&instance=&session=` so the
    // shell + sidekick stay mounted. We forward the encoded pointers
    // into `ProjectAgentChatPanel` for the full session-scoped
    // history fetch and editable send wiring.
    return (
      <ProjectAgentChatPanel
        projectId={queryProjectId}
        agentInstanceId={queryInstanceId}
        sessionId={sessionId}
        initialCreateHandoff={false}
      />
    );
  }

  if (agentId) {
    return (
      <StandaloneAgentChatPanel
        agentId={agentId}
        sessionId={sessionId}
        initialCreateHandoff={isCreateHandoff}
        onInitialHandoffReady={isCreateHandoff ? handleStandaloneHandoffReady : undefined}
      />
    );
  }

  return null;
}
