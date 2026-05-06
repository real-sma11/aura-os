import { useEffect, useMemo, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import {
  agentSessionsSurfaceKey,
  projectSessionsSurfaceKey,
  useAgentBindingsKey,
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
  // match is also the most recent for this agent instance.
  const mostRecentForInstance = useMemo(() => {
    return (
      sessions.find((s) => s._agentInstanceId === agentInstanceId) ?? null
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
 * Subscribes to a stable string fingerprint of the agent's bindings
 * (see `useAgentBindingsKey`) so the redirect re-runs once the
 * background `agentsByProject` prefetch lands — without the
 * fresh-object-array selector pattern that previously triggered an
 * infinite render loop.
 */
export function useDefaultStandaloneSessionRedirect({
  agentId,
  sessionId,
  setSearchParams,
  disabled,
}: StandaloneRedirectOptions): void {
  const surfaceKey = agentId ? agentSessionsSurfaceKey(agentId) : undefined;
  const mostRecent = useMostRecentSession(surfaceKey);
  const bindingsKey = useAgentBindingsKey(agentId);
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const { loadAgentSessions } = useSessionsListActions();
  const didDefaultRef = useRef<string | null>(null);

  // Trigger a load whenever the agent's bindings change shape (e.g. the
  // background prefetch fills in `agentsByProject`) or a write bumps
  // the version. The store's per-surface request-id pattern serializes
  // out-of-order responses.
  useEffect(() => {
    if (disabled || !agentId) return;
    if (sessionId) return;
    if (!bindingsKey) return;
    void loadAgentSessions(agentId);
  }, [
    disabled,
    agentId,
    sessionId,
    bindingsKey,
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
