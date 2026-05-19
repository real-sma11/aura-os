import { useCallback } from "react";
import {
  ModelPicker,
  inputBarShellStyles,
} from "../InputBarShell";
import {
  AURA_MANAGED_CHAT_MODELS,
  defaultModelForAdapter,
  modelLabel,
} from "../../constants/models";
import { useAutomationModel } from "../../stores/automation-loop-store";
import type { ProjectId } from "../../shared/types";
import styles from "./AutomationBar.module.css";

interface AutomationModelPickerProps {
  projectId: ProjectId;
  /**
   * When `true`, the picker is rendered as plain text with no chevron
   * and no menu. The AutomationBar passes `true` once the loop is
   * starting / preparing / active / paused — the chosen model is
   * captured at `startLoop` time, so flipping it mid-run would not
   * affect the running loop and the surface should not pretend
   * otherwise.
   */
  disabled: boolean;
}

/**
 * Dedicated chat-model picker for the AutomationBar in the sidekick.
 *
 * Owns its own per-project selection (persisted to `localStorage` via
 * `automation-loop-store`) so the loop's model is decoupled from
 * whichever chat thread the user happens to be viewing. The list is
 * intentionally limited to `AURA_MANAGED_CHAT_MODELS` because the
 * loop only runs coding tasks — image / 3D / video providers would
 * be invalid here.
 *
 * Visually re-uses the `ModelPicker` chrome from `InputBarShell` so
 * the trigger and dropdown match the chat input bar's picker exactly
 * (same font, hover, portaled menu positioning).
 */
export function AutomationModelPicker({
  projectId,
  disabled,
}: AutomationModelPickerProps) {
  const { model, setModel } = useAutomationModel(projectId);
  const effectiveModelId = model ?? defaultModelForAdapter();
  const label = modelLabel(effectiveModelId);

  const renderMenu = useCallback(
    (close: () => void) => {
      return (
        <div
          className={inputBarShellStyles.modelMenu}
          data-agent-surface="automation-model-picker"
          data-agent-proof="automation-model-picker-visible"
        >
          {AURA_MANAGED_CHAT_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${inputBarShellStyles.modelMenuItem} ${m.id === effectiveModelId ? inputBarShellStyles.modelMenuItemActive : ""}`}
              data-agent-model-id={m.id}
              data-agent-model-label={m.label}
              onClick={() => {
                setModel(m.id);
                close();
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      );
    },
    [effectiveModelId, setModel],
  );

  return (
    <ModelPicker
      selectedLabel={label}
      isInteractive={!disabled}
      renderMenu={renderMenu}
      className={styles.automationModelPicker}
      triggerProps={{
        "data-agent-action": "open-automation-model-picker",
        title: disabled
          ? `Model: ${label} (locked while running)`
          : `Run model: ${label}`,
      }}
    />
  );
}
