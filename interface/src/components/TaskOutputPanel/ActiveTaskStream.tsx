import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { ChevronRight } from "lucide-react";
import { useTaskStream } from "../../hooks/use-task-stream";
import {
  useIsStreaming,
  useIsWriting,
  useStreamingText,
  useThinkingText,
  useThinkingDurationMs,
  useActiveToolCalls,
  useTimeline,
  useProgressText,
  useStreamEvents,
} from "../../hooks/stream/hooks";
import { LLMStreamOutput } from "../ChatOutput";
import { CookingIndicator } from "../CookingIndicator";
import {
  useCooldownStatus,
  renderCooldownMessage,
} from "../../hooks/use-cooldown-status";
import { useProjectActions } from "../../stores/project-action-store";
import { useTaskOutput } from "../../stores/event-store/index";
import { CopyTaskOutputButton } from "./CopyTaskOutputButton";
import { TaskHeaderContextUsage } from "./TaskHeaderContextUsage";
import { buildTaskCopyText } from "./task-copy-utils";
import styles from "./TaskOutputPanel.module.css";

interface ActiveTaskStreamProps {
  taskId: string;
  title?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  isAutoFollowing?: boolean;
  /**
   * Initial collapsed state. The Run pane keeps active rows expanded
   * (so live output is visible immediately); embedding contexts can
   * pass `false` to start collapsed.
   */
  defaultExpanded?: boolean;
  /**
   * Hide the row's chevron/title header. Used when a parent surface
   * already labels the section so the embedded body doesn't repeat
   * the task title above the stream.
   */
  showHeader?: boolean;
}

export function ActiveTaskStream({
  taskId,
  title,
  scrollRef,
  isAutoFollowing = true,
  defaultExpanded = true,
  showHeader = true,
}: ActiveTaskStreamProps) {
  const { streamKey } = useTaskStream(taskId, true);
  const isStreaming = useIsStreaming(streamKey);
  const isWriting = useIsWriting(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const thinkingDurationMs = useThinkingDurationMs(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);
  const progressText = useProgressText(streamKey);
  const events = useStreamEvents(streamKey);
  const taskOutput = useTaskOutput(taskId);
  const ctx = useProjectActions();
  const cooldown = useCooldownStatus(undefined, ctx?.project.project_id);

  const [collapsed, setCollapsed] = useState(!defaultExpanded);

  const hasContent = isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;

  const getCopyText = useCallback(
    () =>
      buildTaskCopyText({
        title: title || taskId,
        status: "in_progress",
        fileOps: taskOutput.fileOps,
        buildSteps: taskOutput.buildSteps,
        testSteps: taskOutput.testSteps,
        gitSteps: taskOutput.gitSteps,
        events,
        fallbackText: taskOutput.text || null,
        liveState: {
          streamingText,
          thinkingText,
          activeToolCalls,
          timeline,
        },
      }),
    [
      title,
      taskId,
      taskOutput.fileOps,
      taskOutput.buildSteps,
      taskOutput.testSteps,
      taskOutput.gitSteps,
      taskOutput.text,
      events,
      streamingText,
      thinkingText,
      activeToolCalls,
      timeline,
    ],
  );

  // Pin to bottom when the tail grows. CSS `overflow-anchor: auto` on the
  // parent scroller (see TaskOutputPanel.module.css `.content`) handles
  // growth *above* the anchor natively; this effect covers growth *at* the
  // anchor (streaming tokens, new tool rows) by pushing scrollTop to the
  // fresh bottom synchronously during commit — before the browser paints
  // the intermediate "pushed up" state. Mirrors ChatMessageList's approach.
  useLayoutEffect(() => {
    if (!scrollRef || !isAutoFollowing || collapsed || !hasContent) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    scrollRef,
    isAutoFollowing,
    collapsed,
    hasContent,
    streamingText,
    thinkingText,
    activeToolCalls.length,
    progressText,
    timeline.length,
  ]);

  const waitingLabel = cooldown.paused
    ? renderCooldownMessage(cooldown)
    : "Waiting for output…";

  return (
    <div className={styles.taskSection}>
      {showHeader && (
        <button
          type="button"
          className={styles.taskHeader}
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className={collapsed ? styles.taskChevron : styles.taskChevronExpanded}>
            <ChevronRight size={10} />
          </span>
          <span className={styles.taskDot} />
          <span className={styles.taskTitle}>{title || taskId}</span>
          <TaskHeaderContextUsage taskId={taskId} />
          <CopyTaskOutputButton getCopyText={getCopyText} />
        </button>
      )}
      {!collapsed && (
        <div className={styles.taskBody}>
          {hasContent ? (
            <LLMStreamOutput
              isStreaming={isStreaming}
              text={streamingText}
              toolCalls={activeToolCalls}
              thinkingText={thinkingText}
              thinkingDurationMs={thinkingDurationMs}
              timeline={timeline}
              progressText={progressText}
              isWriting={isWriting}
              showPhaseIndicator={false}
            />
          ) : (
            <CookingIndicator label={waitingLabel} />
          )}
        </div>
      )}
    </div>
  );
}
