import { useCallback, type RefObject } from "react";
import { Button, GroupCollapsible } from "@cypher-asi/zui";
import { GitCommitHorizontal, Loader2, Play } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { VerificationStepItem } from "../VerificationStepItem";
import { GitStepItem } from "../GitStepItem";
import { TaskMetaSection } from "../TaskMetaSection";
import { TaskFilesSection } from "../TaskFilesSection";
import {
  ActiveTaskStream,
  CompletedTaskOutput,
  CopyTaskOutputButton,
  buildTaskCopyText,
} from "../TaskOutputPanel";
import { useProjectActions } from "../../stores/project-action-store";
import { formatDuration, toBullets } from "../../shared/utils/format";
import {
  useStreamEvents,
  useStreamingText,
  useThinkingText,
  useActiveToolCalls,
  useTimeline,
} from "../../hooks/stream/hooks";
import { useTaskPreviewData, useRunTaskData } from "./useTaskPreviewData";
import styles from "../Preview/Preview.module.css";

export function RunTaskButton({ task }: { task: import("../../shared/types").Task }) {
  const { running, handleRun, visible } = useRunTaskData(task);

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={running ? <Loader2 size={14} className={styles.spinner} /> : <Play size={14} />}
      onClick={visible ? handleRun : undefined}
      disabled={!visible || running}
      title={running ? "Running..." : "Run task"}
      style={visible ? undefined : { visibility: "hidden" }}
    />
  );
}

interface TaskPreviewProps {
  task: import("../../shared/types").Task;
  scrollRef?: RefObject<HTMLDivElement | null>;
  isAutoFollowing?: boolean;
}

export function TaskPreview({ task, scrollRef, isAutoFollowing }: TaskPreviewProps) {
  const {
    taskOutput, effectiveStatus, effectiveSessionId, isActive, isTerminal,
    elapsed, failReason, syncWarning, agentInstance, completedByAgent,
    retrying, handleRetry, handleViewSession,
    fileOps, notes, showNotes, streamKey,
  } = useTaskPreviewData(task);
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;

  const events = useStreamEvents(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);

  const panelStatusLabel: "in_progress" | "completed" | "failed" =
    effectiveStatus === "in_progress" ? "in_progress"
    : effectiveStatus === "failed" ? "failed"
    : "completed";

  const durationLabel = isActive
    ? elapsed > 0 ? formatDuration(elapsed * 1000) : null
    : isTerminal && task.created_at && task.updated_at
      ? formatDuration(
          new Date(task.updated_at).getTime() - new Date(task.created_at).getTime(),
        )
      : null;

  const getCopyText = useCallback(
    () =>
      buildTaskCopyText({
        title: task.title || task.task_id,
        status: panelStatusLabel,
        durationLabel,
        failureReason:
          panelStatusLabel === "failed"
            ? failReason ?? task.execution_notes ?? null
            : null,
        fileOps,
        buildSteps: taskOutput.buildSteps,
        testSteps: taskOutput.testSteps,
        gitSteps: taskOutput.gitSteps,
        events,
        fallbackText: taskOutput.text || null,
        liveState: isActive
          ? { streamingText, thinkingText, activeToolCalls, timeline }
          : null,
      }),
    [
      task.title,
      task.task_id,
      task.execution_notes,
      panelStatusLabel,
      durationLabel,
      failReason,
      fileOps,
      taskOutput.buildSteps,
      taskOutput.testSteps,
      taskOutput.gitSteps,
      taskOutput.text,
      events,
      isActive,
      streamingText,
      thinkingText,
      activeToolCalls,
      timeline,
    ],
  );

  const copyButton = <CopyTaskOutputButton variant="stats" getCopyText={getCopyText} />;

  // For terminal tasks (`done` / `failed`), render the same
  // `CompletedTaskOutput` row the Run pane uses so the live run
  // history persists at the bottom of the preview after the task
  // finishes — matching the data and layout of the Run section.
  // While the task is still active we render `ActiveTaskStream` so
  // the streaming output (text, tool cards, thinking) keeps flowing.
  // Tasks that have never run (no panel entry, ready/pending/...)
  // skip the section entirely so the preview doesn't render an
  // empty "Output" placeholder.
  const panelStatus: "completed" | "failed" | null =
    effectiveStatus === "done" ? "completed"
    : effectiveStatus === "failed" ? "failed"
    : null;
  return (
    <>
      <TaskMetaSection
        task={task}
        effectiveStatus={effectiveStatus}
        effectiveSessionId={effectiveSessionId}
        isActive={isActive}
        elapsed={elapsed}
        failReason={failReason}
        syncWarning={syncWarning}
        agentInstance={agentInstance}
        completedByAgent={completedByAgent}
        retrying={retrying}
        onRetry={handleRetry}
        onViewSession={handleViewSession}
      />

      <TaskFilesSection fileOps={fileOps} />

      {taskOutput.buildSteps.length > 0 && (
        <GroupCollapsible label="Build Verification" count={taskOutput.buildSteps.length} defaultOpen className={styles.section}>
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.buildSteps.map((step, i) => (
                <VerificationStepItem key={i} step={step} active={i === taskOutput.buildSteps.length - 1} variant="build" />
              ))}
            </div>
          </div>
        </GroupCollapsible>
      )}

      {taskOutput.testSteps.length > 0 && (
        <GroupCollapsible label="Test Verification" count={taskOutput.testSteps.length} defaultOpen className={styles.section}>
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.testSteps.map((step, i) => (
                <VerificationStepItem key={i} step={step} active={i === taskOutput.testSteps.length - 1} variant="test" />
              ))}
            </div>
          </div>
        </GroupCollapsible>
      )}

      <GroupCollapsible label="Git Activity" count={taskOutput.gitSteps.length || undefined} defaultOpen className={styles.section}>
        <div className={styles.liveOutputSection}>
          <div className={styles.activityList}>
            {taskOutput.gitSteps.length > 0 ? (
              taskOutput.gitSteps.map((step, i) => (
                <GitStepItem key={i} step={step} />
              ))
            ) : (
              <div className={styles.activityItem}>
                <span className={styles.activityIcon}>
                  <GitCommitHorizontal size={12} style={{ opacity: 0.4 }} />
                </span>
                <span className={styles.activityBody}>
                  <span className={styles.activityMessage} style={{ opacity: 0.5 }}>No commits yet</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </GroupCollapsible>

      {showNotes && (
        <GroupCollapsible label="Notes" defaultOpen className={styles.section}>
          <div className={styles.notesContent}>
            <div className={styles.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {toBullets(notes || "")}
              </ReactMarkdown>
            </div>
          </div>
        </GroupCollapsible>
      )}

      {isActive ? (
        <GroupCollapsible label="Live Output" defaultOpen stats={copyButton} className={styles.section}>
          <div className={styles.liveOutputSection}>
            <ActiveTaskStream
              taskId={task.task_id}
              title={task.title}
              scrollRef={scrollRef}
              isAutoFollowing={isAutoFollowing}
              defaultExpanded
              showHeader={false}
            />
          </div>
        </GroupCollapsible>
      ) : isTerminal && panelStatus && projectId ? (
        <GroupCollapsible label="Output" defaultOpen stats={copyButton} className={styles.section}>
          <div className={styles.liveOutputSection}>
            <CompletedTaskOutput
              taskId={task.task_id}
              projectId={projectId}
              title={task.title}
              status={panelStatus}
              failureReason={failReason ?? task.execution_notes ?? null}
              defaultExpanded
              showDismiss={false}
              showHeader={false}
            />
          </div>
        </GroupCollapsible>
      ) : null}
    </>
  );
}
