import { useCallback, type KeyboardEvent, type MouseEvent } from "react";
import { useContextUsage } from "../../stores/context-usage-store";
import { taskStreamKey } from "../../stores/task-stream-bootstrap";
import { useHydrateContextUtilization } from "../../hooks/use-hydrate-context-utilization";
import { tasksApi } from "../../shared/api/tasks";
import type { ProjectId, TaskId } from "../../shared/types";
import { ContextUsageIndicator } from "../../features/chat-ui/ChatInputBar/ContextUsageIndicator";
import styles from "./TaskOutputPanel.module.css";

interface TaskHeaderContextUsageProps {
  taskId: string;
  /**
   * Project id for the server-side hydration fetch. When omitted, the
   * pill still works for live tasks (the stream handler populates the
   * store directly) but won't show anything for tasks restored after
   * a page reload. Every call site has the project id today; the
   * optional shape is just to keep test fixtures terse.
   */
  projectId?: string;
}

/**
 * Per-task wrapper around `ContextUsageIndicator`. Selects the
 * context-usage entry written by `task-stream-bootstrap` against
 * `taskStreamKey(taskId)` and stops click / keyboard activation events
 * from bubbling so toggling the popover doesn't collapse the parent
 * `.taskHeader` `<button>` row.
 *
 * Hydration: when `projectId` is provided, mount-time hydrate the store
 * from `GET /api/projects/:projectId/tasks/:taskId/context-usage` so
 * cold-loaded historical task rows (e.g. after a refresh, or when
 * opening the Task Preview for a task that finished in a prior session)
 * show the last persisted utilization without waiting for a re-run.
 * The hydration hook itself skips when a value is already present,
 * when a streaming turn is in flight, or when the user has just hit
 * "New session" — see {@link useHydrateContextUtilization}.
 *
 * Visibility guard matches the chat input bar's pill at
 * `ChatInputBar.tsx`: render nothing until utilization > 0 so a
 * brand-new task row doesn't flash a "0% context" pill.
 */
export function TaskHeaderContextUsage({ taskId, projectId }: TaskHeaderContextUsageProps) {
  const streamKey = taskStreamKey(taskId);

  // Stable per-(projectId,taskId) fetcher so the hydration hook's
  // `[streamKey, fetcher, resetKey]` effect doesn't re-fire on every
  // parent render. When projectId is missing we deliberately pass
  // `undefined` so the hook short-circuits (matches `useStandaloneAgentChat`).
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      tasksApi.getContextUsage(projectId as ProjectId, taskId as TaskId, { signal }),
    [projectId, taskId],
  );
  useHydrateContextUtilization(
    streamKey,
    projectId ? fetcher : undefined,
    projectId ? taskId : undefined,
  );

  const usage = useContextUsage(streamKey);
  if (!usage || usage.utilization <= 0) return null;

  const stopMouse = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
  };
  const stopKeyboard = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
    }
  };

  return (
    <span
      className={styles.headerContextUsage}
      onClick={stopMouse}
      onKeyDown={stopKeyboard}
    >
      <ContextUsageIndicator
        utilization={usage.utilization}
        estimatedTokens={usage.estimatedTokens}
        breakdown={usage.breakdown}
      />
    </span>
  );
}
