import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../../api/client";
import { useProjectActions } from "../../stores/project-action-store";
import { useSessionsListStore } from "../../stores/sessions-list-store";
import type { AnnotatedSession } from "../../components/SessionsList";

interface SessionListData {
  sessions: AnnotatedSession[];
  sessionById: Map<string, AnnotatedSession>;
  loading: boolean;
  removeSession: (sessionId: string) => void;
  restoreSession: (session: AnnotatedSession) => void;
}

/**
 * Project-app data source for the shared `SessionsList`. Polls
 * `api.listProjectSessions` (which spans every agent instance in the
 * project) and decorates each row with the underscored
 * `_projectId`/`_agentInstanceId` fields the shared click navigator
 * expects. Re-fetches on `useSessionsListStore.version` so newly
 * created sessions appear as soon as they're persisted server-side.
 */
export function useSessionListData(): SessionListData {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const projectName = ctx?.project.name ?? "";
  const [sessions, setSessions] = useState<AnnotatedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const sessionsVersion = useSessionsListStore((s) => s.version);

  const fetchSessions = useCallback(() => {
    if (!projectId) return;
    api.listProjectSessions(projectId)
      .then((list) => {
        const annotated = list
          .map<AnnotatedSession>((s) => ({
            ...s,
            _projectName: projectName,
            _projectId: s.project_id,
            _agentInstanceId: s.agent_instance_id,
          }))
          .sort(
            (a, b) =>
              new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
          );
        setSessions(annotated);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, projectName]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions, sessionsVersion]);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.session_id, s])),
    [sessions],
  );

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

  return {
    sessions,
    sessionById,
    loading,
    removeSession,
    restoreSession,
  };
}
