import { useCallback, useEffect, useRef } from "react";
import {
  agentSessionsSurfaceKey,
  buildOptimisticSession,
  OPTIMISTIC_SESSION_ID_PREFIX,
  projectSessionsSurfaceKey,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";

interface UseOptimisticSessionRowOptions {
  projectId: string;
  agentInstanceId: string;
  /** Display name for the project (used as the optimistic session label fallback). */
  projectName: string;
  /** Org-level template agent id, used to insert into the agent surface
   *  in addition to the project surface. May be `null` when the binding
   *  isn't resolved yet (the agent surface insert is then skipped). */
  orgAgentId: string | null;
}

interface UseOptimisticSessionRowResult {
  /** Arms the optimistic insert so the very next `wrappedSend` inserts a
   *  placeholder row into the sessions list. Called from the "+ New chat"
   *  handler. */
  arm: () => void;
  /** Wraps a send function: on the first send after `arm`, inserts the
   *  optimistic row and remembers the synthetic id for `swap`. Subsequent
   *  sends pass through unchanged. */
  wrap: <TArgs extends readonly unknown[], TReturn>(
    send: (...args: TArgs) => TReturn,
  ) => (...args: TArgs) => TReturn;
  /** Swap the optimistic row's id for the server-assigned one when
   *  `SessionReady` arrives. Idempotent — no-op when nothing pending. */
  swap: (newSessionId: string) => void;
}

/**
 * Owns the optimistic-session-row lifecycle: insert on first send after
 * "+ New chat", swap the synthetic id for the real one when SessionReady
 * arrives. Replaces the `pendingOptimisticArmedRef` + `pendingOptimisticIdRef`
 * + `insertOptimisticSessionRow` triplet that lived inline in the old
 * `AgentChatPanel`.
 */
export function useOptimisticSessionRow(
  opts: UseOptimisticSessionRowOptions,
): UseOptimisticSessionRowResult {
  const { projectId, agentInstanceId, projectName, orgAgentId } = opts;

  // Keep the resolved org-level agent id behind a ref so `wrap` and
  // `swap` don't get fresh identities every time the projects-list
  // store mutates.
  const orgAgentIdRef = useRef(orgAgentId);
  const projectNameRef = useRef(projectName);
  useEffect(() => {
    orgAgentIdRef.current = orgAgentId;
    projectNameRef.current = projectName;
  });

  const armedRef = useRef(false);
  const pendingIdRef = useRef<string | null>(null);

  const arm = useCallback(() => {
    armedRef.current = true;
  }, []);

  const insertRow = useCallback((): string => {
    const optimisticId = `${OPTIMISTIC_SESSION_ID_PREFIX}${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }`;
    const optimisticSession = buildOptimisticSession({
      optimisticId,
      projectId,
      projectName: projectNameRef.current,
      agentInstanceId,
    });
    const sessionsStore = useSessionsListStore.getState();
    const resolvedOrgAgentId = orgAgentIdRef.current;
    if (resolvedOrgAgentId) {
      sessionsStore.addOptimisticSession(
        agentSessionsSurfaceKey(resolvedOrgAgentId),
        optimisticSession,
      );
    }
    sessionsStore.addOptimisticSession(
      projectSessionsSurfaceKey(projectId),
      optimisticSession,
    );
    return optimisticId;
  }, [projectId, agentInstanceId]);

  const wrap = useCallback(
    <TArgs extends readonly unknown[], TReturn>(
      send: (...args: TArgs) => TReturn,
    ): ((...args: TArgs) => TReturn) =>
      (...args: TArgs) => {
        if (armedRef.current) {
          armedRef.current = false;
          pendingIdRef.current = insertRow();
        }
        return send(...args);
      },
    [insertRow],
  );

  const swap = useCallback((newSessionId: string) => {
    const pendingId = pendingIdRef.current;
    if (!pendingId) return;
    pendingIdRef.current = null;
    const sessionsStore = useSessionsListStore.getState();
    const resolvedOrgAgentId = orgAgentIdRef.current;
    if (resolvedOrgAgentId) {
      sessionsStore.replaceSessionId(
        agentSessionsSurfaceKey(resolvedOrgAgentId),
        pendingId,
        newSessionId,
      );
    }
    sessionsStore.replaceSessionId(
      projectSessionsSurfaceKey(projectId),
      pendingId,
      newSessionId,
    );
  }, [projectId]);

  // Sweep any optimistic placeholder that was inserted but never
  // swapped on unmount. The panel can tear down mid-stream (user
  // navigates to another agent before `SessionReady` arrives, the
  // request is aborted, the network drops, etc.) and a leaked row
  // otherwise sits in `sessionsBySurface` indefinitely — picked up
  // by default-session redirects on revisit and surfaced as a
  // 400 Bad Request when the synthetic id hits the history fetch.
  // Capture `projectId` in the cleanup closure so unmount targets
  // the same surface the row was inserted into.
  useEffect(() => {
    return () => {
      const pendingId = pendingIdRef.current;
      if (!pendingId) return;
      pendingIdRef.current = null;
      const sessionsStore = useSessionsListStore.getState();
      const resolvedOrgAgentId = orgAgentIdRef.current;
      if (resolvedOrgAgentId) {
        sessionsStore.removeSession(
          agentSessionsSurfaceKey(resolvedOrgAgentId),
          pendingId,
        );
      }
      sessionsStore.removeSession(
        projectSessionsSurfaceKey(projectId),
        pendingId,
      );
    };
  }, [projectId]);

  return { arm, wrap, swap };
}
