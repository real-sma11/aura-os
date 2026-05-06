import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveAppId } from "../../hooks/use-active-app";
import type { AnnotatedSession } from "./session-row-utils";

interface UseSessionNavigateOptions {
  /**
   * When the click happens from inside the agents app and we know the
   * agent we're viewing, the navigation stays on `/agents/:agentId` so
   * the agents shell (and its `ChatsTab` sidekick) doesn't unmount.
   * Pass `null` from the projects app — the projects URL is always
   * the right destination there.
   */
  agentId: string | null;
}

/**
 * Shared session-row click handler used by both the agents `ChatsTab`
 * and the projects sidekick. Mirrors the historical-session URL
 * contract documented in `AgentChatView`:
 *
 * - Agents shell:  `/agents/:agentId?project=&instance=&session=`
 * - Projects shell: `/projects/:projectId/agents/:instanceId?session=`
 */
export function useSessionNavigate({ agentId }: UseSessionNavigateOptions) {
  const navigate = useNavigate();
  const activeAppId = useActiveAppId();

  return useCallback(
    (session: AnnotatedSession) => {
      if (activeAppId === "agents" && agentId) {
        const params = new URLSearchParams({
          project: session._projectId,
          instance: session._agentInstanceId,
          session: session.session_id,
        });
        navigate(`/agents/${agentId}?${params.toString()}`);
        return;
      }
      navigate(
        `/projects/${session._projectId}/agents/${session._agentInstanceId}?session=${session.session_id}`,
      );
    },
    [activeAppId, agentId, navigate],
  );
}
