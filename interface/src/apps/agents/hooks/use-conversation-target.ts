import { useEffect, useMemo, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../../api/client";
import {
  sessionHistoryKey,
  useChatHistoryStore,
} from "../../../stores/chat-history-store";
import {
  agentSessionsSurfaceKey,
  projectSessionsSurfaceKey,
  useAgentBindingsKey,
  useAgentBindingsLoadStatus,
  useMostRecentSession,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";

/**
 * Result of resolving the URL for the agent chat surface to a single
 * canonical conversation target.
 *
 * - `ready`: render the project-scoped chat panel for `(projectId,
 *   agentInstanceId, sessionId | null)`. `sessionId === null` means the
 *   user is on a fresh canvas (just clicked `+`).
 * - `pending`: bindings or sessions are still loading. The caller
 *   should hold the previous panel rather than swap to an empty lane;
 *   the previous-panel cache is owned by the caller.
 * - `empty`: the agent has no bindings yet (server-confirmed) so the
 *   standalone panel for an empty agent should mount.
 */
export type ConversationTarget =
  | { kind: "ready"; projectId: string; agentInstanceId: string; sessionId: string | null }
  | { kind: "pending" }
  | { kind: "empty"; agentId: string };

interface UseConversationTargetInput {
  /** Path param from `/projects/:projectId/...`, when present. */
  projectId: string | undefined;
  /** Path param from `/projects/:projectId/agents/:agentInstanceId`. */
  agentInstanceId: string | undefined;
  /** Path param from `/agents/:agentId`. */
  agentId: string | undefined;
  /** `?session=` from URL — the canonical session id when set. */
  sessionId: string | null;
  /** `?project=` mirror used by the agents shell deep links. */
  queryProjectId: string | null;
  /** `?instance=` mirror used by the agents shell deep links. */
  queryInstanceId: string | null;
  /** Used to mirror the resolved `sessionId` back into the URL when it
   * was inferred from "most recent" rather than carried in by the caller. */
  setSearchParams: SetURLSearchParams;
}

/**
 * Resolves the URL into a canonical `ConversationTarget`. Replaces the
 * previous `useStableAgentsShellTarget` + `useStableProjectRouteTarget`
 * pair plus the "last resolved" cache: callers now hold their own
 * previous-target ref and decide whether to render it during `pending`
 * windows.
 *
 * The decision tree, in order:
 *
 *   1. Path carries `(projectId, agentInstanceId)` (project route).
 *      Treat the URL as authoritative; if `?session=` is missing,
 *      default to the most recent session for the instance once the
 *      project's session list resolves.
 *   2. Path carries only `agentId` (agents shell), and URL also
 *      carries `?project=&instance=&session=` — the user clicked a
 *      session row. Render that triple directly.
 *   3. Path carries only `agentId` and the user has previously
 *      visited a session in this lane but cleared `?session=`
 *      (clicked `+` in the input bar). Fall back to standalone fresh
 *      canvas; the next send arms a new session server-side.
 *   4. Path carries only `agentId` and we have a most-recent session
 *      from the agent's bindings — render it.
 *   5. Path carries only `agentId`, bindings loading: pending.
 *   6. Path carries only `agentId`, bindings empty: empty.
 *   7. Sessions still loading: pending.
 *   8. Sessions loaded empty: empty.
 */
export function useConversationTarget(input: UseConversationTargetInput): ConversationTarget {
  const {
    projectId,
    agentInstanceId,
    agentId,
    sessionId,
    queryProjectId,
    queryInstanceId,
    setSearchParams,
  } = input;

  const onProjectRoute = Boolean(projectId && agentInstanceId);

  const projectSurfaceKey = projectId ? projectSessionsSurfaceKey(projectId) : null;
  const projectName = useProjectsListStore((state) =>
    projectId
      ? state.projects.find((p) => p.project_id === projectId)?.name ?? ""
      : "",
  );
  const projectSessions = useSessionsListStore((state) =>
    projectSurfaceKey ? state.sessionsBySurface[projectSurfaceKey] : undefined,
  );

  const standaloneSurfaceKey = agentId ? agentSessionsSurfaceKey(agentId) : undefined;
  const mostRecentStandalone = useMostRecentSession(standaloneSurfaceKey);
  const bindingsKey = useAgentBindingsKey(agentId);
  const bindingsLoadStatus = useAgentBindingsLoadStatus(agentId);
  const standaloneSessionsKnown = useSessionsListStore((state) => {
    if (!standaloneSurfaceKey) return false;
    return state.sessionsBySurface[standaloneSurfaceKey] !== undefined;
  });

  // Latch tracking whether the user has visited a real session in
  // this lane. Reset on lane change. Distinguishes "cold-load with no
  // session" (default-redirect imminent) from "user clicked + to start
  // fresh" (URL just dropped its session).
  const laneKey = onProjectRoute
    ? `project:${projectId}:${agentInstanceId}`
    : agentId
      ? `agent:${agentId}`
      : "";
  const userClearedSession = useUserClearedSession(laneKey, sessionId);

  // Trigger project session load when entering a project route without
  // any cached sessions yet. Side-effect kept as a hook so the resolver
  // remains pure with respect to its return value.
  useEffect(() => {
    if (!onProjectRoute || !projectId) return;
    if (sessionId || userClearedSession) return;
    if (projectSessions !== undefined) return;
    void useSessionsListStore.getState().loadProjectSessions(projectId, projectName);
  }, [onProjectRoute, projectId, projectName, projectSessions, sessionId, userClearedSession]);

  // Most-recent session for the project route's specific instance (used
  // to default-select when `?session=` is missing).
  const mostRecentForInstance = useMemo(() => {
    if (!agentInstanceId || !projectSessions) return null;
    return projectSessions.find((s) => s._agentInstanceId === agentInstanceId) ?? null;
  }, [agentInstanceId, projectSessions]);

  // Eagerly warm the chat-history-store for the resolved (projectId,
  // agentInstanceId, sessionId) so warm switches reveal immediately.
  const warmTarget = useMemo(() => {
    if (onProjectRoute && projectId && agentInstanceId) {
      const resolved = sessionId
        ?? (userClearedSession ? null : mostRecentForInstance?.session_id ?? null);
      if (resolved) return { projectId, agentInstanceId, sessionId: resolved };
      return null;
    }
    if (queryProjectId && queryInstanceId && sessionId) {
      return {
        projectId: queryProjectId,
        agentInstanceId: queryInstanceId,
        sessionId,
      };
    }
    if (agentId && !onProjectRoute && mostRecentStandalone) {
      return {
        projectId: mostRecentStandalone._projectId,
        agentInstanceId: mostRecentStandalone._agentInstanceId,
        sessionId: mostRecentStandalone.session_id,
      };
    }
    return null;
  }, [
    onProjectRoute,
    projectId,
    agentInstanceId,
    sessionId,
    userClearedSession,
    mostRecentForInstance,
    queryProjectId,
    queryInstanceId,
    agentId,
    mostRecentStandalone,
  ]);

  useEffect(() => {
    if (!warmTarget) return;
    const key = sessionHistoryKey(
      warmTarget.projectId,
      warmTarget.agentInstanceId,
      warmTarget.sessionId,
    );
    void useChatHistoryStore.getState().fetchHistory(key, () =>
      api.listSessionEvents(
        warmTarget.projectId,
        warmTarget.agentInstanceId,
        warmTarget.sessionId,
      ),
    );
  }, [warmTarget]);

  // Mirror "most recent for instance" back into the URL on the project
  // route so the rest of the panel sees `?session=` as the single
  // source of truth.
  useEffect(() => {
    if (!onProjectRoute) return;
    const resolved = mostRecentForInstance?.session_id ?? null;
    if (!resolved || sessionId === resolved) return;
    if (userClearedSession) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("session", resolved);
        return next;
      },
      { replace: true },
    );
  }, [onProjectRoute, mostRecentForInstance, sessionId, userClearedSession, setSearchParams]);

  // 1. Project route is authoritative.
  if (onProjectRoute && projectId && agentInstanceId) {
    if (sessionId) {
      return { kind: "ready", projectId, agentInstanceId, sessionId };
    }
    if (userClearedSession) {
      return { kind: "ready", projectId, agentInstanceId, sessionId: null };
    }
    if (mostRecentForInstance) {
      return {
        kind: "ready",
        projectId,
        agentInstanceId,
        sessionId: mostRecentForInstance.session_id,
      };
    }
    if (projectSessions === undefined) {
      return { kind: "pending" };
    }
    // Project sessions known but no row matches this instance — fresh canvas.
    return { kind: "ready", projectId, agentInstanceId, sessionId: null };
  }

  // 2. Agents shell with full URL triple.
  if (agentId && queryProjectId && queryInstanceId && sessionId) {
    return {
      kind: "ready",
      projectId: queryProjectId,
      agentInstanceId: queryInstanceId,
      sessionId,
    };
  }

  // 3. Agents shell, user cleared session in this lane: empty (fresh).
  if (agentId && userClearedSession) {
    if (queryProjectId && queryInstanceId) {
      return {
        kind: "ready",
        projectId: queryProjectId,
        agentInstanceId: queryInstanceId,
        sessionId: null,
      };
    }
    return { kind: "empty", agentId };
  }

  // 4. Agents shell with most-recent across bindings.
  if (agentId && mostRecentStandalone) {
    return {
      kind: "ready",
      projectId: mostRecentStandalone._projectId,
      agentInstanceId: mostRecentStandalone._agentInstanceId,
      sessionId: mostRecentStandalone.session_id,
    };
  }

  if (!agentId) return { kind: "pending" };

  // 5. Bindings still loading.
  if (bindingsLoadStatus === "idle" || bindingsLoadStatus === "loading") {
    return { kind: "pending" };
  }

  // 6. Bindings confirmed empty.
  if (!bindingsKey) return { kind: "empty", agentId };

  // 7. Sessions still loading.
  if (!standaloneSessionsKnown) return { kind: "pending" };

  // 8. Sessions known but empty.
  return { kind: "empty", agentId };
}

/**
 * Holds the previous `ConversationTarget` so the caller can render the
 * old panel during a `pending` window instead of flashing a blank lane.
 * Replaces the previous `useStableAgentsShellTarget` "last resolved"
 * cache with a single, externalized hook.
 */
/* eslint-disable react-hooks/refs -- legitimate prev-value latch read during render */
export function usePreviousReadyTarget(target: ConversationTarget): ConversationTarget {
  const lastReadyRef = useRef<ConversationTarget | null>(null);
  if (target.kind === "pending" && lastReadyRef.current) {
    return lastReadyRef.current;
  }
  if (target.kind !== "pending") {
    lastReadyRef.current = target;
  }
  return target;
}
/* eslint-enable react-hooks/refs */

/** Selector helper used elsewhere; kept colocated with the hook so the
 * ready-history-status check stays close to the resolver that emits it. */
export function useTargetHistoryStatus(target: ConversationTarget): "idle" | "loading" | "ready" | "error" {
  return useChatHistoryStore(
    useShallow((state) => {
      if (target.kind !== "ready" || !target.sessionId) return "ready";
      const key = sessionHistoryKey(
        target.projectId,
        target.agentInstanceId,
        target.sessionId,
      );
      return state.entries[key]?.status ?? "idle";
    }),
  );
}

/**
 * Tracks whether the user previously had a session loaded in this lane
 * and then cleared it (clicked "+" in the input bar). Latched per-lane;
 * resets on lane change. Wraps the canonical "previous value via ref"
 * pattern so the surrounding hook stays free of ref reads.
 */
/* eslint-disable react-hooks/refs -- legitimate prev-value latch read during render */
function useUserClearedSession(laneKey: string, sessionId: string | null): boolean {
  const visitedRef = useRef({ laneKey, visited: Boolean(sessionId) });
  if (visitedRef.current.laneKey !== laneKey) {
    visitedRef.current = { laneKey, visited: Boolean(sessionId) };
  } else if (sessionId) {
    visitedRef.current.visited = true;
  }
  return laneKey !== "" && !sessionId && visitedRef.current.visited;
}
/* eslint-enable react-hooks/refs */
