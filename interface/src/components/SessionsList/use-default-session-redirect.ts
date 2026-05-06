import { useEffect, useMemo, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api/client";
import { useProjectsListStore } from "../../stores/projects-list-store";
import type { AgentInstance, Project } from "../../shared/types";

type AgentBinding = { projectId: string; agentInstanceId: string };
const EMPTY_AGENT_BINDINGS: AgentBinding[] = [];

/**
 * Pick the (projectId, agentInstanceId) pairs an agent participates
 * in. Used by the standalone-agent default-session redirect to find
 * the most recent session across every project the agent is bound to.
 */
function selectAgentBindings(agentId: string | undefined) {
  return (state: {
    projects: Project[];
    agentsByProject: Record<string, AgentInstance[]>;
  }): AgentBinding[] => {
    if (!agentId) return EMPTY_AGENT_BINDINGS;
    const out: AgentBinding[] = [];
    for (const project of state.projects) {
      const instances = state.agentsByProject[project.project_id];
      if (!instances) continue;
      for (const instance of instances) {
        if (instance.agent_id === agentId) {
          out.push({
            projectId: project.project_id,
            agentInstanceId: instance.agent_instance_id,
          });
        }
      }
    }
    return out.length > 0 ? out : EMPTY_AGENT_BINDINGS;
  };
}

interface ProjectRedirectOptions {
  projectId: string;
  agentInstanceId: string;
  sessionId: string | null;
  liveSessionId: string | null;
  setSearchParams: SetURLSearchParams;
}

/**
 * Project-panel default-session redirect: when the user lands on a
 * project-agent chat URL with no `?session=` and no live-session pin,
 * pick the most recent session by `started_at` and replace the URL.
 * Mirrors the sidekick session list so clicking nothing still
 * surfaces the most recent conversation. Guarded by a ref so a single
 * (project, agentInstance) pair only auto-navigates once per mount.
 */
export function useDefaultProjectSessionRedirect({
  projectId,
  agentInstanceId,
  sessionId,
  liveSessionId,
  setSearchParams,
}: ProjectRedirectOptions): void {
  const didDefaultRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${projectId}:${agentInstanceId}`;
    if (sessionId || liveSessionId) {
      didDefaultRef.current = key;
      return;
    }
    if (didDefaultRef.current === key) return;
    didDefaultRef.current = key;
    let cancelled = false;
    api
      .listSessions(projectId, agentInstanceId)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort(
          (a, b) =>
            new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
        );
        const newest = sorted[0];
        if (!newest) return;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("session", newest.session_id);
            return next;
          },
          { replace: true },
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, agentInstanceId, sessionId, liveSessionId, setSearchParams]);
}

interface StandaloneRedirectOptions {
  agentId: string | undefined;
  sessionId: string | null;
  liveSessionId: string | null;
  setSearchParams: SetURLSearchParams;
  /** When `true`, skip the redirect — used when the panel is rendering a project route. */
  disabled?: boolean;
}

/**
 * Standalone-agent default-session redirect: when the user lands on
 * `/agents/:agentId` with no `?session=` (and no live-session pin),
 * pick the most recent session across the agent's project bindings
 * and redirect to the agents-shell historical URL so the same chat
 * panel renders the right transcript.
 */
export function useDefaultStandaloneSessionRedirect({
  agentId,
  sessionId,
  liveSessionId,
  setSearchParams,
  disabled,
}: StandaloneRedirectOptions): void {
  const bindingsSelector = useMemo(() => selectAgentBindings(agentId), [agentId]);
  const agentBindings = useProjectsListStore(useShallow(bindingsSelector));
  const didDefaultRef = useRef<string | null>(null);

  useEffect(() => {
    if (disabled || !agentId) return;
    const key = `agent:${agentId}`;
    if (sessionId || liveSessionId) {
      didDefaultRef.current = key;
      return;
    }
    if (agentBindings.length === 0) return;
    if (didDefaultRef.current === key) return;
    didDefaultRef.current = key;
    let cancelled = false;
    Promise.all(
      agentBindings.map((b) =>
        api
          .listSessions(b.projectId, b.agentInstanceId)
          .then((list) =>
            list.map((s) => ({
              session_id: s.session_id,
              started_at: s.started_at,
              project_id: b.projectId,
              agent_instance_id: b.agentInstanceId,
            })),
          )
          .catch(
            () =>
              [] as {
                session_id: string;
                started_at: string;
                project_id: string;
                agent_instance_id: string;
              }[],
          ),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const flat = results.flat();
        if (flat.length === 0) return;
        flat.sort(
          (a, b) =>
            new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
        );
        const newest = flat[0];
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("project", newest.project_id);
            next.set("instance", newest.agent_instance_id);
            next.set("session", newest.session_id);
            return next;
          },
          { replace: true },
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    disabled,
    agentId,
    sessionId,
    liveSessionId,
    agentBindings,
    setSearchParams,
  ]);
}
