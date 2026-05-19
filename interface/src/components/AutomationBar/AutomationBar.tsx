import { Button, Text, ModalConfirm } from "@cypher-asi/zui";
import { Play, Pause, Square } from "lucide-react";
import { StatusBadge } from "../StatusBadge";
import type { ProjectId } from "../../shared/types";
import { useAutomationStatus } from "./useAutomationStatus";
import { AutomationModelPicker } from "./AutomationModelPicker";
import styles from "./AutomationBar.module.css";

interface AutomationBarProps {
  projectId: ProjectId;
}

/**
 * The Play icon decorated with an optional rotating progress ring.
 *
 * We deliberately keep the Play glyph visible at all times — replacing
 * it with a spinner (Loader2) while the loop was active made the
 * button look like an unrelated affordance, and the moment the loop
 * settled into `active` the spinner flicked off entirely, leaving
 * just a Play icon that read as "click me to start" even though the
 * loop was already running. The ring overlay sits on top of the
 * Play icon so the affordance stays recognisable and the spinning
 * outline communicates "the loop is doing work right now".
 *
 * Ring geometry mirrors `<LoopProgress>` for visual consistency: ~70%
 * arc, 1.1s linear infinite spin, accent stroke.
 */
function PlayWithProgressRing({ active }: { active: boolean }) {
  return (
    <span className={styles.playIconWrap}>
      <Play size={14} />
      {active && (
        <svg
          className={styles.playProgressRing}
          viewBox="0 0 20 20"
          aria-hidden="true"
          data-testid="play-progress-ring"
        >
          <circle
            cx={10}
            cy={10}
            r={8}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={50.27}
            strokeDashoffset={35.2}
          />
        </svg>
      )}
    </span>
  );
}

export function AutomationBar({ projectId }: AutomationBarProps) {
  const {
    status, agentCount, canPlay, canPause, canStop,
    confirmStop, setConfirmStop,
    handleStart, handlePause, handleStop, handleStopConfirm,
    stopError, clearStopError,
  } = useAutomationStatus(projectId);

  // Lock the picker once the loop is starting / preparing / active /
  // paused: the model is captured at `startLoop` time, so flipping it
  // mid-run would have no effect on the running loop. Keeping the
  // trigger interactive in that window would lie to the user about
  // what's actually controlling the run.
  const modelPickerDisabled = status !== "idle" && status !== "stopped";

  // True whenever the loop is actively doing work. We light the Play
  // button's progress ring in all three sub-phases — `starting`
  // (HTTP `startLoop` in flight), `preparing` (server accepted, no
  // `task_started` yet), and `active` (a task is running) — so the
  // visual signal does not flicker off between phases the way the
  // old `starting || preparing` spinner did.
  const loopWorking =
    status === "starting" || status === "preparing" || status === "active";

  return (
    <>
      <div className={styles.automationBar}>
        <div className={styles.automationLabel}>
          <Text size="sm" className={styles.automationLabelBold}>
            Automation
          </Text>
          <StatusBadge status={status} />
          {agentCount > 1 && (
            <Text size="xs" className={styles.automationAgentCount}>{agentCount} agents</Text>
          )}
        </div>
        <div className={styles.automationModelSlot}>
          <AutomationModelPicker
            projectId={projectId}
            disabled={modelPickerDisabled}
          />
        </div>
        <div className={styles.automationControls}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<PlayWithProgressRing active={loopWorking} />}
            onClick={handleStart}
            disabled={!canPlay}
            title={status === "paused" ? "Resume" : "Start"}
            className={loopWorking ? styles.playButtonActive : undefined}
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Pause size={14} />}
            onClick={handlePause}
            disabled={!canPause}
            title="Pause"
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Square size={14} />}
            onClick={handleStop}
            disabled={!canStop}
            title="Stop"
          />
        </div>
      </div>

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
