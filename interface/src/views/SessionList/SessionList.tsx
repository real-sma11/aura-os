import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import {
  type AnnotatedSession,
  formatDeleteSessionError,
  SessionsList,
  useSessionNavigate,
} from "../../components/SessionsList";
import { useSessionListData } from "./useSessionListData";

/**
 * Project-app sidekick "Sessions" tab. Wires the shared `SessionsList`
 * (date-bucketed buttons, summaries, selected-row highlight) to the
 * project-scoped data source. Clicks reuse the same navigator the
 * agents `ChatsTab` uses, so behavior is identical across both apps.
 */
export function SessionList({ searchQuery }: { searchQuery: string }) {
  const {
    sessions,
    loading,
    removeSession,
    restoreSession,
    deleteError,
    setDeleteError,
  } = useSessionListData();
  const handleSessionClick = useSessionNavigate({ agentId: null });
  const [searchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");

  const handleDelete = useCallback(
    (target: AnnotatedSession) => {
      setDeleteError(null);
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
          setDeleteError(formatDeleteSessionError(err));
        });
    },
    [removeSession, restoreSession, setDeleteError],
  );

  const handleDismissError = useCallback(
    () => setDeleteError(null),
    [setDeleteError],
  );

  return (
    <SessionsList
      sessions={sessions}
      loading={loading}
      selectedSessionId={selectedSessionId}
      onSessionClick={handleSessionClick}
      onDeleteSession={handleDelete}
      searchQuery={searchQuery}
      deleteError={deleteError}
      onDismissError={handleDismissError}
    />
  );
}
