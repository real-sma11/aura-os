import { useCallback, useEffect, useRef } from "react";
import { api } from "../../../api/client";
import { deriveProjectAgentTitle } from "../../../lib/derive-project-agent-title";
import {
  mergeAgentIntoProjectAgents,
  projectQueryKeys,
} from "../../../queries/project-queries";
import { queryClient } from "../../../shared/lib/query-client";
import { useProjectsListStore } from "../../../stores/projects-list-store";

interface UseAutoRenameFromPromptOptions {
  projectId: string;
  agentInstanceId: string;
  agentName: string | undefined;
  /** Whether the panel currently has any history loaded; auto-rename only
   *  triggers on a true fresh canvas. */
  hasHistory: boolean;
  /** Pinned URL session id; renaming is suppressed when continuing an
   *  existing session. */
  sessionId: string | null;
}

/**
 * Auto-rename the agent from its first prompt only when:
 *   - The agent still carries the default "New Agent" name.
 *   - The user is on a fresh canvas (no `?session=`, no history).
 *
 * Triggered by `wrapSend` so the call site only has to forward the
 * outgoing prompt content.
 */
export function useAutoRenameFromPrompt(
  opts: UseAutoRenameFromPromptOptions,
): (content: string) => void {
  const setAgentsByProject = useProjectsListStore((s) => s.setAgentsByProject);
  const triggeredRef = useRef(false);

  // Reset the latch when the conversation lane changes.
  useEffect(() => {
    triggeredRef.current = false;
  }, [opts.agentInstanceId, opts.sessionId]);

  // The hook fires `void api.updateAgentInstance(...)` from inside a
  // callback; using a ref for the per-render context keeps the
  // returned callback stable across the parent's renders without
  // re-allocating it whenever `agentName` or `hasHistory` flip.
  const ctxRef = useRef(opts);
  useEffect(() => {
    ctxRef.current = opts;
  });

  return useCallback((content: string) => {
    const ctx = ctxRef.current;
    if (triggeredRef.current) return;
    if (ctx.sessionId) return;
    if (ctx.agentName !== "New Agent") return;
    if (ctx.hasHistory) return;

    const nextName = deriveProjectAgentTitle(content);
    if (!nextName || nextName === "New Agent") return;

    triggeredRef.current = true;
    void api
      .updateAgentInstance(ctx.projectId, ctx.agentInstanceId, { name: nextName })
      .then((updated) => {
        queryClient.setQueryData(
          projectQueryKeys.agentInstance(ctx.projectId, ctx.agentInstanceId),
          updated,
        );
        setAgentsByProject((prev) => ({
          ...prev,
          [ctx.projectId]: mergeAgentIntoProjectAgents(prev[ctx.projectId], updated),
        }));
      })
      .catch((error) => {
        triggeredRef.current = false;
        console.error("Failed to rename project agent from first prompt", error);
      });
  }, [setAgentsByProject]);
}
