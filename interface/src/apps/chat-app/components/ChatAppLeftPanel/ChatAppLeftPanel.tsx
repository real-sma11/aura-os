import { useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "../../../../api/client";
import {
  type AnnotatedSession,
  formatDeleteSessionError,
  SessionsList,
} from "../../../../components/SessionsList";
import { EmptyState } from "../../../../components/EmptyState";
import { ProjectsPlusButton } from "../../../../components/ProjectsPlusButton";
import {
  agentSessionsSurfaceKey,
  useSessionsDeleteError,
  useSessionsForSurface,
  useSessionsListActions,
  useSessionsListStore,
} from "../../../../stores/sessions-list-store";
import {
  sessionHistoryKey,
  useChatHistoryStore,
} from "../../../../stores/chat-history-store";
import { useSidebarSearch } from "../../../../hooks/use-sidebar-search";
import { useChatAppAgent } from "../../hooks/use-chat-app-agent";
import styles from "./ChatAppLeftPanel.module.css";

/**
 * Date-bucketed sessions list for the Chat app's left panel. Reuses
 * the shared `SessionsList` (the same component the Agents app's
 * `ChatsTab` and the Projects app's `SessionList` mount) keyed on the
 * chat agent's surface key.
 *
 * Click → `/chat?session=<id>` so navigation stays inside the Chat
 * app rather than rerouting into the Agents shell. Hover prefetches
 * the destination's chat-history-store entry so the panel mounts on a
 * `historyResolved=true` first render and skips the cold-load reveal.
 *
 * Header surfaces a `+` button via `useSidebarSearch("chat").setAction`
 * so it lands in the shared sidebar search header next to the search
 * input — same UX as the Agents and Projects apps.
 */
export function ChatAppLeftPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");
  const { agent: chatAgent, status: agentStatus } = useChatAppAgent();
  const chatAgentId = chatAgent?.agent_id;
  const surfaceKey = chatAgentId
    ? agentSessionsSurfaceKey(chatAgentId)
    : undefined;
  const sessions = useSessionsForSurface(surfaceKey);
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const isLoading = useSessionsListStore((s) =>
    surfaceKey ? (s.loadingBySurface[surfaceKey] ?? false) : false,
  );
  const { loadAgentSessions, removeSession, restoreSession, setDeleteError } =
    useSessionsListActions();
  const deleteError = useSessionsDeleteError(surfaceKey);
  const { query: searchQuery, setAction } = useSidebarSearch("chat");

  useEffect(() => {
    if (!chatAgentId) return;
    void loadAgentSessions(chatAgentId);
  }, [chatAgentId, sessionsVersion, loadAgentSessions]);

  const handleNewChat = useCallback(() => {
    // Navigating to `/chat` (no `?session=`) lands on a fresh canvas.
    // The route's `useStandaloneAgentChat` wiring handles the empty
    // `pinnedSessionId` and arms the next send to create a session.
    navigate("/chat");
  }, [navigate]);

  useEffect(() => {
    setAction(
      "chat",
      <ProjectsPlusButton onClick={handleNewChat} title="New chat" />,
    );
    return () => setAction("chat", null);
  }, [handleNewChat, setAction]);

  const handleSessionClick = useCallback(
    (target: AnnotatedSession) => {
      navigate(`/chat?session=${target.session_id}`);
    },
    [navigate],
  );

  const handleSessionHover = useCallback((target: AnnotatedSession) => {
    void useChatHistoryStore.getState().fetchHistory(
      sessionHistoryKey(
        target._projectId,
        target._agentInstanceId,
        target.session_id,
      ),
      () =>
        api.listSessionEvents(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        ),
    );
  }, []);

  const handleDelete = useCallback(
    (target: AnnotatedSession) => {
      if (!surfaceKey) return;
      setDeleteError(surfaceKey, null);
      removeSession(surfaceKey, target.session_id);
      api
        .deleteSession(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        )
        .catch((err) => {
          console.error("Failed to delete session", err);
          restoreSession(surfaceKey, target);
          setDeleteError(surfaceKey, formatDeleteSessionError(err));
        });
    },
    [surfaceKey, removeSession, restoreSession, setDeleteError],
  );

  const handleDismissError = useCallback(() => {
    if (!surfaceKey) return;
    setDeleteError(surfaceKey, null);
  }, [surfaceKey, setDeleteError]);

  if (!chatAgent) {
    if (agentStatus === "loading") {
      return (
        <div className={styles.loadingState}>
          <Loader2 size={16} className="animate-spin" aria-hidden />
          <span>Starting chat…</span>
        </div>
      );
    }
    return <EmptyState>Couldn't load chat history.</EmptyState>;
  }

  return (
    <div className={styles.root} data-agent-surface="chat-app-sessions-list">
      <SessionsList
        sessions={sessions}
        loading={isLoading}
        selectedSessionId={selectedSessionId}
        onSessionClick={handleSessionClick}
        onSessionHover={handleSessionHover}
        onDeleteSession={handleDelete}
        searchQuery={searchQuery}
        deleteError={deleteError}
        onDismissError={handleDismissError}
      />
    </div>
  );
}
