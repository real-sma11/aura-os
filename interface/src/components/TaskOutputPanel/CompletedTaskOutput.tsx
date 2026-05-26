import { useCallback, useState } from "react";
import { Check, X as XIcon, AlertTriangle, CircleDashed, ChevronRight } from "lucide-react";
import {
  useTaskOutputPanelStore,
  type PanelTaskFailureContext,
  type PanelTaskStatus,
} from "../../stores/task-output-panel-store";
import { useTaskOutputView } from "../../hooks/use-task-output-view";
import { extractErrorMessage } from "../../shared/utils/extract-error-message";
import { useTaskOutput } from "../../stores/event-store/index";
import { MessageBubble, LLMOutput } from "../ChatOutput";
import { CopyTaskOutputButton } from "./CopyTaskOutputButton";
import { TaskHeaderContextUsage } from "./TaskHeaderContextUsage";
import { buildTaskCopyText } from "./task-copy-utils";
import styles from "./TaskOutputPanel.module.css";

interface CompletedTaskOutputProps {
  taskId: string;
  projectId: string;
  title: string;
  status: PanelTaskStatus;
  failureReason?: string | null;
  /**
   * Structured provider context forwarded by the server on the
   * `task_failed` event. Rendered as a compact mono label under the
   * reason so operators can grab `req=req_01 · claude-sonnet-4 ·
   * api_error` in one glance. Absent for failures that don't carry an
   * upstream provider context (completion-gate rejections, synthetic
   * "finished without terminal" events, …).
   */
  failureContext?: PanelTaskFailureContext;
  /**
   * Initial collapsed state. The Run pane keeps its rows collapsed
   * until clicked; embedding contexts (e.g. the Tasks-tab task
   * preview) prefer the body expanded by default so the run history
   * is visible without an extra click.
   */
  defaultExpanded?: boolean;
  /**
   * When `false`, the dismiss "X" button is hidden. Embedding contexts
   * outside the Run pane (the task preview) shouldn't expose the
   * destructive "drop this row from the panel" affordance — that
   * interaction belongs to the Run pane only.
   */
  showDismiss?: boolean;
  /**
   * Hide the row's chevron/title header. Used when a parent surface
   * already labels the section (e.g. the Tasks-tab task preview) so
   * the embedded body doesn't repeat the task title above the run
   * history.
   */
  showHeader?: boolean;
}

/**
 * Build the short "`req=… · model=… · type=…`" label rendered
 * underneath the failure reason. Returns `null` when no field is
 * populated so the row collapses back to its pre-Commit-E layout for
 * failures without provider context.
 */
function formatFailureContext(ctx: PanelTaskFailureContext | undefined): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.providerRequestId) parts.push(`req=${ctx.providerRequestId}`);
  if (ctx.model) parts.push(ctx.model);
  if (ctx.sseErrorType) parts.push(ctx.sseErrorType);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function CompletedTaskOutput({
  taskId,
  projectId,
  title,
  status,
  failureReason,
  failureContext,
  defaultExpanded = false,
  showDismiss = true,
  showHeader = true,
}: CompletedTaskOutputProps) {
  const dismissTask = useTaskOutputPanelStore((s) => s.dismissTask);
  // `CompletedTaskOutput` only renders for non-active rows, so every
  // mount is a terminal view from the hook's perspective.
  const { events, fallbackText, hasStructuredContent, hasAnyContent } =
    useTaskOutputView(taskId, projectId, true);
  const taskOutput = useTaskOutput(taskId);

  const getCopyText = useCallback(
    () =>
      buildTaskCopyText({
        title: title || taskId,
        status,
        failureReason: status === "failed" ? failureReason ?? null : null,
        failureContext: status === "failed" ? failureContext ?? null : null,
        fileOps: taskOutput.fileOps,
        buildSteps: taskOutput.buildSteps,
        testSteps: taskOutput.testSteps,
        gitSteps: taskOutput.gitSteps,
        events,
        fallbackText,
      }),
    [
      title,
      taskId,
      status,
      failureReason,
      failureContext,
      taskOutput.fileOps,
      taskOutput.buildSteps,
      taskOutput.testSteps,
      taskOutput.gitSteps,
      events,
      fallbackText,
    ],
  );

  // Default collapsed in the Run pane so a long history doesn't blow
  // out the panel; the task preview opts in to `defaultExpanded` so
  // the run output is visible without an extra click. Either way we
  // remember once the user toggles it so re-renders (e.g. driven by
  // hydration finishing) do not yank the body closed.
  const [collapsed, setCollapsed] = useState(!defaultExpanded);

  const statusIcon =
    status === "failed" ? <AlertTriangle size={10} />
    : status === "interrupted" ? <CircleDashed size={10} />
    : <Check size={10} />;

  const dotClass =
    status === "failed" ? styles.taskDotFailed
    : status === "interrupted" ? styles.taskDotInterrupted
    : styles.taskDotCompleted;

  const statusLabel =
    status === "failed" ? "Failed"
    : status === "interrupted" ? "Interrupted"
    : "Done";

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
          <span className={dotClass}>{statusIcon}</span>
          <span className={styles.taskTitle}>{title || taskId}</span>
          <span className={styles.taskStatusBadge} data-status={status}>{statusLabel}</span>
          <CopyTaskOutputButton getCopyText={getCopyText} />
          <TaskHeaderContextUsage taskId={taskId} projectId={projectId} />
          {showDismiss && (
            <span
              role="button"
              tabIndex={0}
              className={styles.dismissBtn}
              onClick={(e) => {
                e.stopPropagation();
                dismissTask(taskId);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  dismissTask(taskId);
                }
              }}
              title="Dismiss"
              aria-label="Dismiss task output"
            >
              <XIcon size={10} />
            </span>
          )}
        </button>
      )}
      {!collapsed && (
        <>
          {status === "failed" && failureReason && (
            <div className={styles.failReasonBanner}>
              {extractErrorMessage(failureReason)}
              {(() => {
                const label = formatFailureContext(failureContext);
                return label ? (
                  <div
                    className={styles.failReasonContext}
                    data-testid="task-failure-context"
                  >
                    {label}
                  </div>
                ) : null;
              })()}
            </div>
          )}
          {hasStructuredContent ? (
            <div className={styles.taskBody}>
              {events.map((evt) => (
                <MessageBubble key={evt.id} message={evt} />
              ))}
            </div>
          ) : fallbackText ? (
            <div className={styles.taskBody}>
              <LLMOutput content={fallbackText} />
            </div>
          ) : status === "failed" && failureReason ? (
            // The failure reason itself is the body; no need to also
            // show the generic "Task failed without producing output."
            null
          ) : (
            <div className={styles.taskBodyEmpty}>
              {status === "failed"
                ? "Task failed without producing output."
                : status === "interrupted"
                  ? "Run was interrupted before completing."
                  : hasAnyContent
                    ? "No text output captured for this run."
                    : "No output captured for this run."}
            </div>
          )}
        </>
      )}
    </div>
  );
}
