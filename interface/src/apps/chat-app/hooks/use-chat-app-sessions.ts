import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  agentSessionsSurfaceKey,
  sortSessionsDesc,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";
import type { AnnotatedSession } from "../../../components/SessionsList";
import { useAgents } from "../../agents/stores";
import type { Agent } from "../../../shared/types";

interface ChatAppSessionsSlice {
  /** Merged, newest-first AnnotatedSession list across every agent. */
  sessions: AnnotatedSession[];
  /**
   * `true` while at least one per-agent surface is still loading AND
   * the merged list is still empty. Once any agent's first batch lands
   * we flip to `false` so the panel can paint rows immediately instead
   * of waiting for every fan-out to settle.
   */
  loading: boolean;
}

const EMPTY_SESSIONS: AnnotatedSession[] = [];

/**
 * Cross-agent session list for the Chat app's left panel. Aggregates
 * every agent's `sessionsBySurface[agent:<id>]` entry from
 * `useSessionsListStore` and returns a single sorted array.
 *
 * The store keeps each agent's rows in `sortSessionsDesc` order
 * already, but the per-agent arrays are sorted independently — a
 * naive flat-concat would mis-interleave dates across agents. Re-sort
 * after merge to keep the bucketization correct.
 *
 * The fan-out fetch itself is owned by `ChatAppLeftPanel` (it calls
 * `loadAgentSessions(agentId)` for each agent on mount and on the
 * sessions-version bumps); this hook only reads the resulting state.
 */
export function useChatAppSessions(agents: Agent[]): ChatAppSessionsSlice {
  const agentIds = useMemo(
    () => agents.map((a) => a.agent_id),
    [agents],
  );

  const perAgent = useSessionsListStore(
    useShallow((state) => {
      const out: Array<AnnotatedSession[]> = [];
      for (const id of agentIds) {
        const list = state.sessionsBySurface[agentSessionsSurfaceKey(id)];
        if (list && list.length > 0) out.push(list);
      }
      return out;
    }),
  );

  const anyLoading = useSessionsListStore((state) => {
    for (const id of agentIds) {
      if (state.loadingBySurface[agentSessionsSurfaceKey(id)]) return true;
    }
    return false;
  });

  const merged = useMemo(() => {
    if (perAgent.length === 0) return EMPTY_SESSIONS;
    if (perAgent.length === 1) return perAgent[0];
    return sortSessionsDesc(perAgent.flat());
  }, [perAgent]);

  return useMemo(
    () => ({
      sessions: merged,
      loading: anyLoading && merged.length === 0,
    }),
    [merged, anyLoading],
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
