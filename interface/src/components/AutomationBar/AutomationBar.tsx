import { Button, Text, ModalConfirm } from "@cypher-asi/zui";
import { Play, Pause, Square, Loader2 } from "lucide-react";
import { StatusBadge } from "../StatusBadge";
import type { ProjectId } from "../../shared/types";
import { useAutomationStatus } from "./useAutomationStatus";
import { AutomationModelPicker } from "./AutomationModelPicker";
import styles from "./AutomationBar.module.css";

interface AutomationBarProps {
  projectId: ProjectId;
}

export function AutomationBar({ projectId }: AutomationBarProps) {
  const {
    status, agentCount, canPlay, canPause, canStop,
    starting, preparing, confirmStop, setConfirmStop,
    handleStart, handlePause, handleStop, handleStopConfirm,
    stopError, clearStopError,
  } = useAutomationStatus(projectId);

  // Lock the picker once the loop is starting / preparing / active /
  // paused: the model is captured at `startLoop` time, so flipping it
  // mid-run would have no effect on the running loop. Keeping the
  // trigger interactive in that window would lie to the user about
  // what's actually controlling the run.
  const modelPickerDisabled = status !== "idle" && status !== "stopped";

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
            icon={starting || preparing ? <Loader2 size={14} className={styles.automationSpinner} /> : <Play size={14} />}
            onClick={handleStart}
            disabled={!canPlay}
            title={status === "paused" ? "Resume" : "Start"}
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
