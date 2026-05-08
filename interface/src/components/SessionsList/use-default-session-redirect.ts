import { useEffect, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import {
  agentSessionsSurfaceKey,
  useMostRecentSession,
  useSessionsListActions,
  useSessionsListStore,
} from "../../stores/sessions-list-store";

// Project-route default-session redirect lives in
// `apps/agents/hooks/use-conversation-target.ts` so a single writer
// owns `?session=` for the project route. The previous
// `useDefaultProjectSessionRedirect` hook was folded in there; this
// file now only exports the standalone-agents redirect.

interface StandaloneRedirectOptions {
  agentId: string | undefined;
  sessionId: string | null;
  setSearchParams: SetURLSearchParams;
  /** When `true`, skip the redirect — used when the panel is rendering a project route. */
  disabled?: boolean;
}

/**
 * Standalone-agent default-session redirect: when the user lands on
 * `/agents/:agentId` with no `?session=`, redirect to the most recent
 * session across the agent's project bindings.
 *
 * The redirect waits on `useSessionsListStore`'s shared per-surface
 * fan-out, which now sources bindings from the server-authoritative
 * `GET /api/agents/:agent_id/projects` endpoint instead of an
 * active-org-scoped client snapshot. That keeps the redirect honest
 * for agents whose only binding is a Home / cross-org project the
 * current sidebar doesn't surface.
 */
export function useDefaultStandaloneSessionRedirect({
  agentId,
  sessionId,
  setSearchParams,
  disabled,
}: StandaloneRedirectOptions): void {
  const surfaceKey = agentId ? agentSessionsSurfaceKey(agentId) : undefined;
  const mostRecent = useMostRecentSession(surfaceKey);
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const { loadAgentSessions } = useSessionsListActions();
  const didDefaultRef = useRef<string | null>(null);

  // Trigger a load on agent change or any version bump. The loader is
  // self-sufficient — it fetches `listProjectBindings` from the server
  // before fanning out per-binding `listSessions` — so we don't gate
  // on a client-derived bindings fingerprint. (That fingerprint used
  // to come from the active-org `useProjectsListStore`, which silently
  // hides Home / cross-org bindings and was the cause of the empty
  // session-history bug for legacy remote agents.) The store's
  // per-surface request id serializes out-of-order responses.
  useEffect(() => {
    if (disabled || !agentId) return;
    if (sessionId) return;
    void loadAgentSessions(agentId);
  }, [
    disabled,
    agentId,
    sessionId,
    sessionsVersion,
    loadAgentSessions,
  ]);

  useEffect(() => {
    if (disabled || !agentId) return;
    const key = `agent:${agentId}`;
    if (sessionId) {
      didDefaultRef.current = key;
      return;
    }
    if (didDefaultRef.current === key) return;
    if (!mostRecent) return;
    didDefaultRef.current = key;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("project", mostRecent._projectId);
        next.set("instance", mostRecent._agentInstanceId);
        next.set("session", mostRecent.session_id);
        return next;
      },
      { replace: true },
    );
  }, [
    disabled,
    agentId,
    sessionId,
    mostRecent,
    setSearchParams,
  ]);
}
