import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../api/client";
import {
  type AnnotatedSession,
  SessionsList,
  useSessionNavigate,
} from "../../../components/SessionsList";
import { useSessionsListStore } from "../../../stores/sessions-list-store";
import type { Agent } from "../../../shared/types";

type ProjectBinding = {
  project_agent_id: string;
  project_id: string;
  project_name: string;
};

function useAgentSessions(
  agentId: string,
  projectBindings: ProjectBinding[],
) {
  const [sessions, setSessions] = useState<AnnotatedSession[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped by `handleNewChat` and the chat stream when a new session
  // is persisted server-side (`SessionReady`). Re-running the effect
  // is how we pick up sessions created from the chat input "+" or
  // RotateCcw without needing a manual refresh.
  const sessionsVersion = useSessionsListStore((s) => s.version);

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      projectBindings.map((b) =>
        api.listSessions(b.project_id, b.project_agent_id)
          .then((list) =>
            list.map<AnnotatedSession>((s) => ({
              ...s,
              _projectName: b.project_name,
              _projectId: b.project_id,
              _agentInstanceId: b.project_agent_id,
            })),
          )
          .catch(() => [] as AnnotatedSession[]),
      ),
    ).then((results) => {
      if (cancelled) return;
      const all = results
        .flat()
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
      setSessions(all);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [agentId, projectBindings, sessionsVersion]);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  }, []);

  const restoreSession = useCallback((session: AnnotatedSession) => {
    setSessions((prev) => {
      if (prev.some((s) => s.session_id === session.session_id)) return prev;
      return [...prev, session].sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
    });
  }, []);

  return { sessions, loading, removeSession, restoreSession };
}

export function ChatsTab({
  agent,
  projectBindings,
}: {
  agent: Agent;
  projectBindings: ProjectBinding[];
}) {
  const { sessions, loading, removeSession, restoreSession } = useAgentSessions(
    agent.agent_id,
    projectBindings,
  );
  const handleSessionClick = useSessionNavigate({ agentId: agent.agent_id });
  const [searchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");

  const handleDelete = useCallback(
    (target: AnnotatedSession) => {
      removeSession(target.session_id);
      api
        .deleteSession(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        )
        .catch((err) => {
          console.error("Failed to delete session", err);
          restoreSession(target);
        });
    },
    [removeSession, restoreSession],
  );

  return (
    <SessionsList
      sessions={sessions}
      loading={loading}
      selectedSessionId={selectedSessionId}
      onSessionClick={handleSessionClick}
      onDeleteSession={handleDelete}
    />
  );
}
