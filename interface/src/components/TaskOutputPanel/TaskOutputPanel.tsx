import { useRef } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Text, ModalConfirm } from "@cypher-asi/zui";
import { Trash2, Play, Pause, Square, Loader2 } from "lucide-react";
import {
  useTaskOutputPanelStore,
  useTasksForProject,
} from "../../stores/task-output-panel-store";
import { useProjectActions } from "../../stores/project-action-store";
import { selectProjectActivity, useLoopActivityStore } from "../../stores/loop-activity-store";
import { useAutomationStatus } from "../AutomationBar/useAutomationStatus";
import { AutomationModelPicker } from "../AutomationBar/AutomationModelPicker";
import { useScrollAnchorV2 } from "../../shared/hooks/use-scroll-anchor-v2";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { TerminalPanelBody } from "../TerminalPanelBody";
import { TerminalInstanceTabs } from "../TerminalInstanceTabs";
import { ActiveTaskStream } from "./ActiveTaskStream";
import { CompletedTaskOutput } from "./CompletedTaskOutput";
import { PinnedTaskStreamingIndicator } from "./PinnedTaskStreamingIndicator";
import { CookingIndicator } from "../CookingIndicator";
import styles from "./TaskOutputPanel.module.css";

function AutomationControls({ projectId }: { projectId: string }) {
  const {
    canPlay, canPause, canStop, starting, preparing,
    handleStart, handlePause, handleStop, handleStopConfirm,
    confirmStop, setConfirmStop,
    stopError, clearStopError,
  } = useAutomationStatus(projectId);

  const showStopPause = canPause || canStop;

  return (
    <>
      {!showStopPause && (
        <button
          type="button"
          className={styles.runBtnGroup}
          onClick={handleStart}
          disabled={!canPlay}
          title="Run"
          aria-label="Run automation"
        >
          {starting || preparing
            ? <Loader2 size={11} className={styles.spinner} />
            : <Play size={11} />}
          <span>Run</span>
        </button>
      )}
      {showStopPause && (
        <>
          {canPlay && (
            <button
              type="button"
              className={styles.runBtnGroup}
              onClick={handleStart}
              title="Resume"
              aria-label="Resume automation"
            >
              <Play size={11} />
              <span>Run</span>
            </button>
          )}
          {canPause && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={handlePause}
              title="Pause"
              aria-label="Pause automation"
            >
              <Pause size={11} />
            </button>
          )}
          <button
            type="button"
            className={styles.headerBtn}
            onClick={handleStop}
            disabled={!canStop}
            title="Stop"
            aria-label="Stop automation"
          >
            <Square size={11} />
          </button>
        </>
      )}

      <ModalConfirm
        isOpen={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={handleStopConfirm}
        title="Stop Execution"
        message="Stop autonomous execution? The current task will complete first."
        confirmLabel="Stop"
        cancelLabel="Cancel"
        danger
      />

      {stopError && (
        <ModalConfirm
          isOpen
          onClose={clearStopError}
          onConfirm={clearStopError}
          title="Stop failed"
          message={stopError}
          confirmLabel="Dismiss"
          cancelLabel="Close"
        />
      )}
    </>
  );
}

/**
 * Inline model picker for the Run pane header. Wraps the shared
 * `AutomationModelPicker` so we can lock its trigger while the loop is
 * starting / preparing / active / paused — the model is captured at
 * `startLoop` time, so allowing the user to flip it mid-run would lie
 * about what's actually steering the running loop. Kept as its own
 * component so `useAutomationStatus` only fires when we have a real
 * `projectId` to scope the loop status fetch to.
 *
 * Shares the same `automation-loop-store` slot as the
 * `SidekickHeader`/`AutomationBar` picker, so the two surfaces stay
 * in lockstep and both flow into the next `startLoop` call.
 */
function RunPaneModelPicker({ projectId }: { projectId: string }) {
  const { status } = useAutomationStatus(projectId);
  const disabled = status !== "idle" && status !== "stopped";
  return (
    <div className={styles.headerModelSlot}>
      <AutomationModelPicker projectId={projectId} disabled={disabled} />
    </div>
  );
}

/**
 * Pinned cooking strip for the Run pane. Mirrors the `loopWorking`
 * derivation used by `AutomationBar` (`PlayLoopGlyph`) so the shimmer
 * lights up in lockstep with the progress glyph — even during the
 * `starting` / `preparing` window before the first `task_started`
 * event has produced any stream deltas. Once an active task exists we
 * pass its id so the indicator can swap from the static `Cooking...`
 * fallback to `getStreamingPhaseLabel`'s richer `Thinking...` / tool
 * labels. Extracted into its own component so `useAutomationStatus`
 * only mounts when we have a real `projectId`.
 */
function RunPaneCookingIndicator({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string | undefined;
}) {
  const { status } = useAutomationStatus(projectId);
  const loopWorking =
    status === "starting" || status === "preparing" || status === "active";
  if (!loopWorking && !taskId) return null;
  return (
    <PinnedTaskStreamingIndicator
      taskId={taskId ?? ""}
      className={styles.pinnedStreamingIndicator}
      forceShow={loopWorking}
    />
  );
}

function loopPlanningLabel(
  status: ReturnType<typeof useAutomationStatus>["status"],
  currentStep: string | null | undefined,
): string {
  if (currentStep === "thinking") return "Thinking…";
  if (currentStep === "processing") return "Processing…";
  if (currentStep?.startsWith("tool:")) {
    return `Running ${currentStep.slice("tool:".length)}…`;
  }
  if (currentStep) return `${currentStep}…`;
  if (status === "preparing") return "Preparing…";
  return "Planning…";
}

/**
 * Loop-level placeholder shown while automation is running but no backlog
 * task has been claimed yet (harness planning / context-gather phase).
 * Falls back to the static empty state when the loop is idle.
 */
function RunPaneEmptyState({ projectId }: { projectId: string }) {
  const { status } = useAutomationStatus(projectId);
  const loopWorking =
    status === "starting" || status === "preparing" || status === "active";
  const activity = useLoopActivityStore(
    useShallow((s) => selectProjectActivity(s, projectId)),
  );
  if (loopWorking) {
    return (
      <div className={styles.emptyState} data-testid="run-pane-planning-placeholder">
        <CookingIndicator label={loopPlanningLabel(status, activity?.current_step)} />
      </div>
    );
  }
  return (
    <div className={styles.emptyState}>
      <Text size="sm" className={styles.emptyText}>No tasks</Text>
    </div>
  );
}

export function RunSidekickPane() {
  const clearCompleted = useTaskOutputPanelStore((s) => s.clearCompleted);
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const { agentInstanceId } = useParams<{ agentInstanceId?: string }>();
  // The Run pane shows project-scoped automation activity. Don't filter by
  // the URL's `agentInstanceId` here: that param is the *chat* agent the
  // user is currently viewing, while the loop runs on a separate
  // `Loop`-role instance (see `useAutomationStatus` -> `boundLoopId`). If
  // we filter by the chat instance id, every `task_started` row produced
  // by the loop is silently dropped because its `agent_id` is the loop
  // instance, not the chat one — the exact regression where the pane sits
  // on "No tasks" forever after Run is pressed.
  const projectTasks = useTasksForProject(projectId);
  const hasCompleted = projectTasks.some((t) => t.status !== "active");
  // After `demoteStaleActive`, at most one row should be "active" per
  // pane. Pick it (the newest wins if a brief window ever produces
  // two) so we can pin its cooking indicator above the sidekick fade.
  const activeTask =
    [...projectTasks]
      .filter((t) => t.status === "active")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

  const contentRef = useRef<HTMLDivElement>(null);
  const { handleScroll, isAutoFollowing } = useScrollAnchorV2(contentRef, {
    resetKey: `${projectId ?? ""}:${agentInstanceId ?? ""}`,
  });

  return (
    <div className={styles.sidekickPane}>
      <div className={styles.sidekickPaneHeader}>
        <div className={styles.headerActions}>
          {projectId && <AutomationControls projectId={projectId} />}
          {projectId && <RunPaneModelPicker projectId={projectId} />}
          {hasCompleted && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={clearCompleted}
              title="Clear completed"
              aria-label="Clear completed task output"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.contentShell}>
        <div
          className={styles.content}
          ref={contentRef}
          onScroll={handleScroll}
        >
          {projectTasks.length === 0 ? (
            projectId ? (
              <RunPaneEmptyState projectId={projectId} />
            ) : (
              <div className={styles.emptyState}>
                <Text size="sm" className={styles.emptyText}>No tasks</Text>
              </div>
            )
          ) : (
            projectTasks.map((entry) =>
              entry.status === "active" ? (
                <ActiveTaskStream
                  key={entry.taskId}
                  taskId={entry.taskId}
                  title={entry.title}
                  scrollRef={contentRef}
                  isAutoFollowing={isAutoFollowing}
                />
              ) : (
                <CompletedTaskOutput
                  key={entry.taskId}
                  taskId={entry.taskId}
                  projectId={entry.projectId}
                  title={entry.title}
                  status={entry.status}
                  failureReason={entry.failureReason}
                  failureContext={entry.failureContext}
                />
              ),
            )
          )}
        </div>
        {projectId && (
          <RunPaneCookingIndicator
            projectId={projectId}
            taskId={activeTask?.taskId}
          />
        )}
        <OverlayScrollbar scrollRef={contentRef} />
      </div>
    </div>
  );
}

export function TerminalSidekickPane() {
  return (
    <div className={styles.terminalContent}>
      <TerminalInstanceTabs />
      <TerminalPanelBody embedded />
    </div>
  );
}
