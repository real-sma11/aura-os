import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { AnnotatedSession } from "./session-row-utils";

/**
 * Mirror persisted summaries onto a flat record and lazily summarize
 * sessions that don't have one yet, exactly like the original Chats
 * tab implementation. Lifted into the shared component so the project
 * sidekick gets the same Haiku-summarize behavior for free.
 */
export function useSessionSummaries(
  sessions: AnnotatedSession[],
): Record<string, string> {
  const persistedSummaries = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of sessions) {
      if (s.summary_of_previous_context) {
        out[s.session_id] = s.summary_of_previous_context;
      }
    }
    return out;
  }, [sessions]);

  const [fetchedSummaries, setFetchedSummaries] = useState<Record<string, string>>({});
  const summarizingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const session of sessions) {
      if (session.summary_of_previous_context) continue;
      // Optimistic "New chat" placeholder rows live entirely client-side
      // (synthesized by `useSessionsListStore.setPendingNewChat`) and
      // would 404 the summarize endpoint. Skip them; the real row that
      // replaces the placeholder on `SessionReady` will summarize on
      // its own.
      if ((session as { _pending?: boolean })._pending) continue;
      if (summarizingRef.current.has(session.session_id)) continue;

      // Always attempt one Haiku summarize per session-without-summary per
      // mount. The dedupe ref keeps us from spamming the LLM, and the
      // backend cheaply returns "" for empty transcripts (see
      // `generate_session_summary` in
      // `apps/aura-os-server/src/handlers/agents/sessions.rs`), which
      // we ignore so truly empty sessions stay placeholdered.
      summarizingRef.current.add(session.session_id);
      api
        .summarizeSession(session._projectId, session._agentInstanceId, session.session_id)
        .then((updated) => {
          if (updated.summary_of_previous_context) {
            setFetchedSummaries((prev) => ({
              ...prev,
              [session.session_id]: updated.summary_of_previous_context,
            }));
          }
        })
        .catch(() => {});
    }
  }, [sessions]);

  return useMemo(
    () => ({ ...fetchedSummaries, ...persistedSummaries }),
    [fetchedSummaries, persistedSummaries],
  );
}
