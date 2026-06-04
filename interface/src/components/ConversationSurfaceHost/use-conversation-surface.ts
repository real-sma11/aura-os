import { useCallback } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import {
  conversationLaneKey,
  useConversationRouteParams,
} from "../../apps/agents/hooks/use-conversation-route";
import {
  useConversationTarget,
  usePreviousReadyTarget,
  type ConversationTarget,
} from "../../apps/agents/hooks/use-conversation-target";
import { useDefaultStandaloneSessionRedirect } from "../SessionsList/use-default-session-redirect";
import { useChatHandoffStore } from "../../stores/chat-handoff-store";
import {
  isCreateAgentChatHandoff,
  projectAgentHandoffTarget,
  standaloneAgentHandoffTarget,
} from "../../utils/chat-handoff";

export type ConversationSurface = {
  /** True when the current URL is an agent chat lane. */
  isConversationRoute: boolean;
  /** Resolved target, held through resolver `pending` windows. */
  target: ConversationTarget;
  /** Stable mount identity for the rendered chat panel. */
  laneKey: string;
  /** `?session=` carried by the URL (used by the standalone panel). */
  sessionId: string | null;
  /** Path `:agentId` when on the standalone agents shell. */
  agentId?: string;
  /** True when the URL itself is a project chat path (vs the agents shell). */
  isProjectPathRoute: boolean;
  /** True when this lane was opened via a `create-agent` handoff. */
  isCreateHandoff: boolean;
  onProjectHandoffReady: () => void;
  onStandaloneHandoffReady: () => void;
};

/**
 * Render-time derivation that drives the persistent conversation surface.
 *
 * Everything here is computed synchronously from routing + store state: the
 * URL is parsed into target inputs, the resolver returns a canonical target,
 * and `usePreviousReadyTarget` holds the last ready target across `pending`
 * windows. No `useEffect`-based state mirroring and no prop drilling — the
 * panels read their data straight from the target-keyed zustand stores.
 */
export function useConversationSurface(): ConversationSurface {
  const routeParams = useConversationRouteParams();
  const [, setSearchParams] = useSearchParams();
  const location = useLocation();

  const isCreateHandoff =
    routeParams.isConversationRoute && isCreateAgentChatHandoff(location.state);
  const completeCreateAgentHandoff = useChatHandoffStore(
    (s) => s.completeCreateAgentHandoff,
  );

  // Standalone-agent default-session redirect (single writer). Disabled on
  // project routes and whenever we are off a conversation surface.
  useDefaultStandaloneSessionRedirect({
    agentId: routeParams.agentId,
    sessionId: routeParams.sessionId,
    setSearchParams,
    disabled: Boolean(routeParams.projectId) || !routeParams.isConversationRoute,
  });

  const liveTarget = useConversationTarget({
    projectId: routeParams.projectId,
    agentInstanceId: routeParams.agentInstanceId,
    agentId: routeParams.agentId,
    sessionId: routeParams.sessionId,
    queryProjectId: routeParams.queryProjectId,
    queryInstanceId: routeParams.queryInstanceId,
    setSearchParams,
  });

  // Hold the last ready target across `pending` windows so cross-app and
  // cross-session switches reveal instantly instead of flashing a blank lane.
  // This also keeps the previous chat mounted (hidden) while the user is on a
  // non-conversation route, so returning to it is instant.
  const target = usePreviousReadyTarget(liveTarget);
  const laneKey = conversationLaneKey(target);

  const onProjectHandoffReady = useCallback(() => {
    if (target.kind !== "ready") return;
    completeCreateAgentHandoff(
      projectAgentHandoffTarget(target.projectId, target.agentInstanceId),
    );
  }, [target, completeCreateAgentHandoff]);

  const onStandaloneHandoffReady = useCallback(() => {
    if (!routeParams.agentId) return;
    completeCreateAgentHandoff(standaloneAgentHandoffTarget(routeParams.agentId));
  }, [routeParams.agentId, completeCreateAgentHandoff]);

  return {
    isConversationRoute: routeParams.isConversationRoute,
    target,
    laneKey,
    sessionId: routeParams.sessionId,
    agentId: routeParams.agentId,
    isProjectPathRoute: Boolean(routeParams.projectId),
    isCreateHandoff,
    onProjectHandoffReady,
    onStandaloneHandoffReady,
  };
}
