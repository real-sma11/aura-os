import { useMemo } from "react";
import {
  useSessionsForSurface,
  useSessionsLoading,
  userSessionsSurfaceKey,
} from "../../../stores/sessions-list-store";
import type { AnnotatedSession } from "../../../components/SessionsList";
import { useAgents } from "../../agents/stores";
import type { Agent } from "../../../shared/types";

interface ChatAppSessionsSlice {
  /** Newest-first AnnotatedSession list across every agent the user owns. */
  sessions: AnnotatedSession[];
  /**
   * `true` while the user-scoped session fetch is in flight AND the
   * merged list is still empty. Once the first batch lands we flip
   * to `false` so the panel can paint rows immediately.
   */
  loading: boolean;
}

/**
 * Cross-agent session list for the Chat app's left panel.
 *
 * Reads from the singleton user-sessions surface populated by
 * `loadUserSessions` (a single `/api/me/sessions` call backed by
 * aura-storage's `idx_sessions_user_recent` partial index, migration
 * 0015). Replaces the previous fan-out reader that aggregated every
 * agent's `agent:<id>` surface and re-sorted -- the server now owns
 * the merge + sort, so this hook is a straight surface read.
 *
 * `agents` is retained as an argument purely so the existing
 * `useChatAppSessions(agents)` callers don't have to change their
 * signature; the value is no longer consumed because the merged
 * list arrives pre-aggregated from the server.
 */
export function useChatAppSessions(_agents: Agent[]): ChatAppSessionsSlice {
  const surfaceKey = userSessionsSurfaceKey();
  const sessions = useSessionsForSurface(surfaceKey);
  const isLoading = useSessionsLoading(surfaceKey);

  return useMemo(
    () => ({
      sessions,
      loading: isLoading && sessions.length === 0,
    }),
    [sessions, isLoading],
  );
}

/**
 * Hook variant that reads `useAgents()` directly. Use when the caller
 * doesn't already have the agents list at hand. Components that
 * already pull `useAgents()` for other reasons should call the
 * `useChatAppSessions(agents)` overload above to avoid a duplicate
 * store subscription.
 */
export function useChatAppAllSessions(): ChatAppSessionsSlice {
  const { agents } = useAgents();
  return useChatAppSessions(agents);
}
