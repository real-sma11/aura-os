import { useEffect, useMemo, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import {
  agentSessionsSurfaceKey,
  isOptimisticSessionId,
  projectSessionsSurfaceKey,
  useMostRecentSession,
  useSessionsForSurface,
  useSessionsListActions,
  useSessionsListStore,
} from "../../stores/sessions-list-store";

interface ProjectRedirectOptions {
  projectId: string;
  agentInstanceId: string;
  sessionId: string | null;
  setSearchParams: SetURLSearchParams;
}

/**
 * Project-panel default-session redirect: when the user lands on a
 * project-agent chat URL with no `?session=`, pick the most recent
 * session for the active agent instance and replace the URL with
 * `?session=<id>`. Now that session views are editable, this is just
 * "open your last chat".
 *
 * The hook reads from the shared `useSessionsListStore` instead of
 * issuing its own `api.listSessions` request, so the redirect always
 * agrees with the sidekick that's rendering the same list. The store
 * holds project-wide sessions; we filter to the active instance here.
 */
export function useDefaultProjectSessionRedirect({
  projectId,
  agentInstanceId,
  sessionId,
  setSearchParams,
}: ProjectRedirectOptions): void {
  const surfaceKey = projectSessionsSurfaceKey(projectId);
  const sessions = useSessionsForSurface(surfaceKey);
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const didDefaultRef = useRef<string | null>(null);

  // Sessions are stored sorted desc by `started_at`, so the first
  // match is also the most recent for this agent instance. Skip
  // optimistic placeholder rows: a leaked optimistic id (e.g. the
  // panel was unmounted mid-stream before `SessionReady` could swap
  // it for the real id) would otherwise be primed into the URL as
  // `?session=optimistic:...`, immediately 400ing the history fetch.
  const mostRecentForInstance = useMemo(() => {
    return (
      sessions.find(
        (s) =>
          s._agentInstanceId === agentInstanceId &&
          !isOptimisticSessionId(s.session_id),
      ) ?? null
    );
  }, [sessions, agentInstanceId]);

  // Trigger a load if the store doesn't yet have this project. The
  // store dedupes via per-surface request ids; recalling on every
  // render-tick when nothing has changed is cheap because the deps
  // gate the effect.
  useEffect(() => {
    if (sessionId) return;
    void useSessionsListStore.getState().loadProjectSessions(projectId, "");
  }, [projectId, sessionId, sessionsVersion]);

  useEffect(() => {
    const key = `${projectId}:${agentInstanceId}`;
    if (sessionId) {
      didDefaultRef.current = key;
      return;
    }
    if (didDefaultRef.current === key) return;
    if (!mostRecentForInstance) return;
    didDefaultRef.current = key;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("session", mostRecentForInstance.session_id);
        return next;
      },
      { replace: true },
    );
  }, [
    projectId,
    agentInstanceId,
    sessionId,
    mostRecentForInstance,
    setSearchParams,
  ]);
}

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
