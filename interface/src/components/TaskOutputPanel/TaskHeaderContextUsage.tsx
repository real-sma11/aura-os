import type { KeyboardEvent, MouseEvent } from "react";
import { useContextUsage } from "../../stores/context-usage-store";
import { taskStreamKey } from "../../stores/task-stream-bootstrap";
import { ContextUsageIndicator } from "../../features/chat-ui/ChatInputBar/ContextUsageIndicator";
import styles from "./TaskOutputPanel.module.css";

interface TaskHeaderContextUsageProps {
  taskId: string;
}

/**
 * Per-task wrapper around `ContextUsageIndicator`. Selects the
 * context-usage entry written by `task-stream-bootstrap` against
 * `taskStreamKey(taskId)` and stops click / keyboard activation events
 * from bubbling so toggling the popover doesn't collapse the parent
 * `.taskHeader` `<button>` row.
 *
 * Visibility guard matches the chat input bar's pill at
 * `ChatInputBar.tsx`: render nothing until the harness has reported a
 * non-zero utilization (otherwise a brand-new task row would flash a
 * "0% context" pill before the first AssistantMessageEnd lands).
 */
export function TaskHeaderContextUsage({ taskId }: TaskHeaderContextUsageProps) {
  const usage = useContextUsage(taskStreamKey(taskId));
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
