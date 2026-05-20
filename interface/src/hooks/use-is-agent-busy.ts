import { useShallow } from "zustand/react/shallow";

import {
  selectAgentActivity,
  useLoopActivityStore,
} from "../stores/loop-activity-store";
import { useProjectsListStore } from "../stores/projects-list-store";
import { useSidekickStore } from "../stores/sidekick-store";
import { isLoopActivityActive } from "../shared/types/aura-events";
import { useStreamStore } from "./stream/store";

/**
 * Aggregate "this agent template is actively working right now" signal
 * for any UI that pivots on a template `agent_id` (e.g. the agents-app
 * sidebar row). Three independent sources need to be combined because
 * each one only covers part of the surface area:
 *
 *  1. `useLoopActivityStore` — backed by `LoopOpened` / `LoopActivityChanged`
 *     events. Only fires for `LoopKind::Automation` / `Spec` today
 *     (chat turns do not open registry loops), so on its own it would
 *     miss any in-flight chat the user is having.
 *
 *  2. `useStreamStore.entries[agentId]` — the standalone-agent chat
 *     path (`useAgentChatStream`) keys its stream entry by the
 *     template `agentId` directly. `isStreaming === true` on that
 *     entry is the canonical "we're streaming a turn for this
 *     template, no project binding" signal.
 *
 *  3. `useSidekickStore.streamingAgentInstanceIds` cross-referenced
 *     with `useProjectsListStore.agentsByProject` — the project chat
 *     path (`useChatStream`) keys its stream entry by
 *     `${projectId}:${agentInstanceId}` and stamps the
 *     `agentInstanceId` into the sidekick store on send. We map every
 *     known instance of this template back to its template id so a
 *     send on *any* of them lights up the sidebar row, even when the
 *     user is chatting on a project surface and the agents-app
 *     sidebar is just visible behind it.
 *
 * Returns a single boolean so call sites can pass it straight into a
 * `busy` prop without re-deriving anything. Each subscription uses
 * `useShallow` (or selects a primitive) so the hook only re-renders
 * its caller when *this* template's busy bit flips.
 */
export function useIsAgentBusy(agentId: string | undefined | null): boolean {
  const hasActiveLoop = useLoopActivityStore(
    useShallow((s) => {
      if (!agentId) return false;
      const a = selectAgentActivity(s, agentId);
      return !!a && isLoopActivityActive(a.status);
    }),
  );

  const isStandaloneChatStreaming = useStreamStore(
    (s) => !!agentId && (s.entries[agentId]?.isStreaming ?? false),
  );

  // Pull only the instance ids that belong to this template. `useShallow`
  // keeps the array reference stable across unrelated agentsByProject
  // edits so the downstream `.some()` subscription stays cheap.
  const templateInstanceIds = useProjectsListStore(
    useShallow((s) => {
      if (!agentId) return [] as string[];
      const ids: string[] = [];
      for (const list of Object.values(s.agentsByProject)) {
        for (const inst of list) {
          if (inst.agent_id === agentId) ids.push(inst.agent_instance_id);
        }
      }
      return ids;
    }),
  );

  const isProjectChatStreaming = useSidekickStore((s) => {
    if (templateInstanceIds.length === 0) return false;
    return templateInstanceIds.some((id) =>
      s.streamingAgentInstanceIds.includes(id),
    );
  });

  return hasActiveLoop || isStandaloneChatStreaming || isProjectChatStreaming;
}
