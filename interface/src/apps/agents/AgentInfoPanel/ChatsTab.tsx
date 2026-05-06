import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../api/client";
import {
  type AnnotatedSession,
  SessionsList,
  useSessionNavigate,
} from "../../../components/SessionsList";
import {
  agentSessionsSurfaceKey,
  useAgentBindingsKey,
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
  const bindingsKey = useAgentBindingsKey(agentId);
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const isLoading = useSessionsListStore((s) =>
    surfaceKey ? (s.loadingBySurface[surfaceKey] ?? false) : false,
  );
  const { loadAgentSessions, removeSession, restoreSession } =
    useSessionsListActions();
  const handleSessionClick = useSessionNavigate({ agentId: agentId ?? null });
  const [searchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");

  // Re-fan-out when the agent's bindings change shape (background
  // `agentsByProject` prefetch lands) or a write bumps the version
  // (chat-input "+" / RotateCcw / `SessionReady`). The store itself
  // handles the request-id race protection.
  useEffect(() => {
    if (!agentId) return;
    if (!bindingsKey) return;
    void loadAgentSessions(agentId);
  }, [agentId, bindingsKey, sessionsVersion, loadAgentSessions]);

  const handleDelete = useCallback(
    (target: AnnotatedSession) => {
      if (!surfaceKey) return;
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
        });
    },
    [surfaceKey, removeSession, restoreSession],
  );

  if (!selectedAgent) {
    return <EmptyState>Select an agent to see details</EmptyState>;
  }

  return (
    <SessionsList
      sessions={sessions}
      loading={isLoading}
      selectedSessionId={selectedSessionId}
      onSessionClick={handleSessionClick}
      onDeleteSession={handleDelete}
    />
  );
}
