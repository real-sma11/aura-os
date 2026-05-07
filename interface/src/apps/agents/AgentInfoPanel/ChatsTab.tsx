import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../api/client";
import {
  type AnnotatedSession,
  formatDeleteSessionError,
  SessionsList,
  useSessionNavigate,
} from "../../../components/SessionsList";
import {
  agentSessionsSurfaceKey,
  useAgentBindingsKey,
  usePendingNewChat,
  useSessionsDeleteError,
  useSessionsForSurface,
  useSessionsListActions,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";
import { useSelectedAgent } from "../stores";
import { EmptyState } from "../../../components/EmptyState";

/**
 * Agents-app sidekick "Chats" tab. Pulls the active agent from
 * `useSelectedAgent()` and reads its session list from the shared
 * `useSessionsListStore`. The tab no longer takes any props — both
 * the agent and its bindings come from stores so the same panel works
 * whether it is mounted from the agents shell or the marketplace
 * preview.
 */
export function ChatsTab() {
  const { selectedAgent } = useSelectedAgent();
  const agentId = selectedAgent?.agent_id;
  const surfaceKey = agentId ? agentSessionsSurfaceKey(agentId) : undefined;
  const sessions = useSessionsForSurface(surfaceKey);
  const pendingNewChat = usePendingNewChat(surfaceKey);
  const bindingsKey = useAgentBindingsKey(agentId);
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const isLoading = useSessionsListStore((s) =>
    surfaceKey ? (s.loadingBySurface[surfaceKey] ?? false) : false,
  );
  const { loadAgentSessions, removeSession, restoreSession, setDeleteError } =
    useSessionsListActions();
  const deleteError = useSessionsDeleteError(surfaceKey);
  const navigateToSession = useSessionNavigate({ agentId: agentId ?? null });
  const [searchParams] = useSearchParams();
  // The URL `?session=` wins when present; otherwise the optimistic
  // placeholder owns the highlight. Without this, clicking "+" leaves
  // the sidekick with no row highlighted (URL just dropped the
  // session) and the user gets no immediate feedback that they're now
  // on a fresh canvas.
  const urlSelectedSessionId = searchParams.get("session");
  const effectiveSelectedSessionId =
    urlSelectedSessionId ?? pendingNewChat?.session_id ?? null;

  // Re-fan-out when the agent's bindings change shape (background
  // `agentsByProject` prefetch lands) or a write bumps the version
  // (chat-input "+" / RotateCcw / `SessionReady`). The store itself
  // handles the request-id race protection.
  useEffect(() => {
    if (!agentId) return;
    if (!bindingsKey) return;
    void loadAgentSessions(agentId);
  }, [agentId, bindingsKey, sessionsVersion, loadAgentSessions]);

  // Click handler short-circuits on the optimistic placeholder — the
  // user is already on the fresh canvas, so the row click is a no-op.
  // (Routing the click through `useSessionNavigate` would push a URL
  // with the synthetic `pending-new-chat` id, which `AgentChatView`
  // would treat as a real session pointer and 404 on history fetch.)
  const handleSessionClick = useCallback(
    (target: AnnotatedSession) => {
      if ((target as { _pending?: boolean })._pending) return;
      navigateToSession(target);
    },
    [navigateToSession],
  );

  const handleDelete = useCallback(
    (target: AnnotatedSession) => {
      if (!surfaceKey) return;
      // Defensive: SessionsList already filters pending rows out of the
      // context-menu wiring. The duplicate guard keeps a future caller
      // from accidentally deleting a placeholder via the imperative
      // `onDeleteSession` prop.
      if ((target as { _pending?: boolean })._pending) return;
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

  if (!selectedAgent) {
    return <EmptyState>Select an agent to see details</EmptyState>;
  }

  return (
    <SessionsList
      sessions={sessions}
      loading={isLoading}
      selectedSessionId={effectiveSelectedSessionId}
      onSessionClick={handleSessionClick}
      onDeleteSession={handleDelete}
      deleteError={deleteError}
      onDismissError={surfaceKey ? () => setDeleteError(surfaceKey, null) : undefined}
    />
  );
}
