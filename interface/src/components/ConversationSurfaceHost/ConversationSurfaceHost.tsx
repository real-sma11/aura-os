import { cn } from "@cypher-asi/zui";

import { AgentChatPanel } from "../../apps/agents/components/AgentChatPanel";
import { StandaloneAgentChatPanel } from "../../apps/agents/components/StandaloneAgentChatPanel";
import { useConversationSurface } from "./use-conversation-surface";
import { useConversationSurfaceSync } from "./use-conversation-surface-sync";
import styles from "./ConversationSurfaceHost.module.css";

/**
 * Persistent, conversation-target-keyed host for the agent chat.
 *
 * Mounted exactly once per shell (desktop `AuraShell` and `MobileShell`) as a
 * STABLE sibling of the per-app `MainPanel`, so it survives every Agents <->
 * Projects app switch. Because the rendered chat is keyed by the conversation
 * LANE (`projectId` + `agentInstanceId`), switching apps onto the same lane
 * keeps the identical `AgentChatPanel` element mounted: zero remount, no
 * refetch, instant.
 *
 * Both the agents-shell route (`/agents/:agentId`) and the project route
 * (`/projects/:projectId/agents/:agentInstanceId`) resolve to the same target
 * via `useConversationSurface`, so the route elements themselves render
 * nothing — this host owns the chat. When the URL is not a conversation route
 * the last lane stays mounted but hidden, making a return to chat instant.
 */
export function ConversationSurfaceHost(): React.ReactElement | null {
  const surface = useConversationSurface();
  useConversationSurfaceSync({
    isConversationRoute: surface.isConversationRoute,
    target: surface.target,
    agentId: surface.agentId,
  });

  const content = renderTarget(surface);
  if (!content) return null;

  return (
    <div
      className={cn(styles.surface, !surface.isConversationRoute && styles.hidden)}
      data-agent-surface="agent-chat-panel"
      data-agent-context="agent-chat-product-context"
      data-agent-agent-id={surface.agentId ?? ""}
      aria-hidden={!surface.isConversationRoute || undefined}
    >
      {content}
    </div>
  );
}

function renderTarget(
  surface: ReturnType<typeof useConversationSurface>,
): React.ReactNode {
  const { target, laneKey, sessionId, isCreateHandoff, isProjectPathRoute } = surface;

  if (target.kind === "pending") {
    // Only paint the placeholder when we're actually on a conversation route
    // with nothing held yet; otherwise render nothing (host returns null).
    return surface.isConversationRoute ? (
      <div className={styles.lanePlaceholder} aria-hidden="true" />
    ) : null;
  }

  if (target.kind === "empty") {
    return (
      <StandaloneAgentChatPanel
        key={laneKey}
        agentId={target.agentId}
        sessionId={sessionId}
        freshCanvasPending={false}
        initialCreateHandoff={isCreateHandoff}
        onInitialHandoffReady={
          isCreateHandoff ? surface.onStandaloneHandoffReady : undefined
        }
      />
    );
  }

  const projectHandoff = isCreateHandoff && isProjectPathRoute;
  return (
    <AgentChatPanel
      key={laneKey}
      projectId={target.projectId}
      agentInstanceId={target.agentInstanceId}
      sessionId={target.sessionId}
      initialCreateHandoff={projectHandoff}
      onInitialHandoffReady={projectHandoff ? surface.onProjectHandoffReady : undefined}
    />
  );
}
