import { useCallback } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { useChatHandoffStore } from "../../../../stores/chat-handoff-store";
import {
  isCreateAgentChatHandoff,
  projectAgentHandoffTarget,
  standaloneAgentHandoffTarget,
} from "../../../../utils/chat-handoff";
import { useDefaultStandaloneSessionRedirect } from "../../../../components/SessionsList/use-default-session-redirect";
import { AgentChatPanel } from "../AgentChatPanel";
import { StandaloneAgentChatPanel } from "../StandaloneAgentChatPanel";
import {
  useConversationTarget,
  usePreviousReadyTarget,
  useTargetHistoryStatus,
} from "../../hooks/use-conversation-target";
import styles from "./AgentChatRoute.module.css";

/**
 * Top-level route entry shared by `/projects/:projectId/agents/:agentInstanceId`
 * and `/agents/:agentId`. Resolves the URL into a single
 * `ConversationTarget` and dispatches to:
 *
 *   - `AgentChatPanel` for the canonical project-scoped triple.
 *   - `StandaloneAgentChatPanel` for the genuine "agent has no
 *     bindings yet" case.
 *   - A lane placeholder while bindings/sessions are still loading
 *     (avoids a single-frame blank lane on first visit to an
 *     uncached agent).
 *
 * Replaces the previous 1157-line `AgentChatView` orchestrator.
 */
export function AgentChatRoute() {
  const { projectId, agentInstanceId, agentId } = useParams<{
    projectId: string;
    agentInstanceId: string;
    agentId: string;
  }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const queryProjectId = searchParams.get("project");
  const queryInstanceId = searchParams.get("instance");
  const isCreateHandoff = isCreateAgentChatHandoff(location.state);
  const completeCreateAgentHandoff = useChatHandoffStore((s) => s.completeCreateAgentHandoff);

  // Standalone-agent default-session redirect: when the user lands on
  // `/agents/:agentId` with no `?session=`, replace the URL with the
  // most-recent session across the agent's bindings.
  useDefaultStandaloneSessionRedirect({
    agentId,
    sessionId,
    setSearchParams,
    disabled: Boolean(projectId),
  });

  const liveTarget = useConversationTarget({
    projectId,
    agentInstanceId,
    agentId,
    sessionId,
    queryProjectId,
    queryInstanceId,
    setSearchParams,
  });

  // While the next session's history is still cold-loading, hold the
  // previous panel mounted to avoid the per-panel cold-load reveal
  // blinking the lane between two distinct sessions.
  const targetHistoryStatus = useTargetHistoryStatus(liveTarget);
  const holdPrevious =
    liveTarget.kind === "ready" && liveTarget.sessionId !== null &&
    (targetHistoryStatus === "idle" || targetHistoryStatus === "loading");
  // Hold the previous ready target across resolver `pending` windows and
  // cold history loads so the user sees the previous panel instead of a
  // blank/flickering lane while the destination warms.
  const target = usePreviousReadyTarget(liveTarget, holdPrevious);

  const handleProjectHandoffReady = useCallback(() => {
    if (target.kind !== "ready") return;
    completeCreateAgentHandoff(
      projectAgentHandoffTarget(target.projectId, target.agentInstanceId),
    );
  }, [target, completeCreateAgentHandoff]);

  const handleStandaloneHandoffReady = useCallback(() => {
    if (!agentId) return;
    completeCreateAgentHandoff(standaloneAgentHandoffTarget(agentId));
  }, [agentId, completeCreateAgentHandoff]);

  if (target.kind === "pending") {
    return <div className={styles.lanePlaceholder} aria-hidden="true" />;
  }

  if (target.kind === "empty") {
    return (
      <StandaloneAgentChatPanel
        agentId={target.agentId}
        sessionId={sessionId}
        freshCanvasPending={false}
        initialCreateHandoff={isCreateHandoff}
        onInitialHandoffReady={isCreateHandoff ? handleStandaloneHandoffReady : undefined}
      />
    );
  }

  return (
    <AgentChatPanel
      projectId={target.projectId}
      agentInstanceId={target.agentInstanceId}
      sessionId={target.sessionId}
      initialCreateHandoff={isCreateHandoff && Boolean(projectId)}
      onInitialHandoffReady={isCreateHandoff && projectId ? handleProjectHandoffReady : undefined}
    />
  );
}
