import { memo, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import {
  EFFORT_LABELS,
  effectiveCreditMultiplier,
  formatContextWindow,
  formatCreditMultiplier,
  type ModelEffort,
  type ModelOption,
} from "../../constants/models";
import { useFlyoutAnchor } from "./use-flyout-anchor";
import styles from "./InputBarShell.module.css";

export interface ModelMenuRowProps {
  model: ModelOption;
  /** Whether this model is the currently selected one. */
  isActive: boolean;
  /**
   * Effort currently applied to the active model (only meaningful when
   * `isActive`), used to highlight the matching flyout option.
   */
  activeEffort?: ModelEffort | null;
  /** Disable selection (e.g. "coming soon" providers). */
  disabled?: boolean;
  /** Suffix appended after the label (e.g. " (coming soon)"). */
  labelSuffix?: string;
  /**
   * Select the model. `effort` is provided when the choice came from the
   * effort flyout; omitted for a plain row click (caller resolves the
   * default).
   */
  onSelect: (modelId: string, effort?: ModelEffort) => void;
}

const FLYOUT_WIDTH = 184;

// Only one effort flyout should ever be mounted. Each row registers an
// immediate-close callback here while its flyout is open; opening a new row's
// flyout synchronously closes the previous one so the two portals never
// overlap (which otherwise renders a brief "ghost" of the prior submenu
// during the close delay window).
let closeActiveFlyout: (() => void) | null = null;

/**
 * One row of the chat model picker. Renders the model label plus a credit
 * multiplier badge, and reveals a hover flyout describing the model: a
 * header with the name, cost multiple, and context window, followed by a
 * reasoning-effort selector for models that declare `efforts`. The flyout
 * is rendered through a `document.body` portal (anchored to the row's
 * bounding rect) because the scrolling `.modelMenu` container clips any
 * sideways child.
 */
export const ModelMenuRow = memo(function ModelMenuRow({
  model,
  isActive,
  activeEffort,
  disabled = false,
  labelSuffix,
  onSelect,
}: ModelMenuRowProps) {
  const rowRef = useRef<HTMLButtonElement>(null);
  // Stores this row's close handler so the module-level single-open slot
  // can dismiss it when another row takes over. Populated after the hook
  // returns its (stable) `immediateClose`.
  const selfCloseRef = useRef<() => void>(() => {});

  const hasEfforts = !disabled && !!model.efforts && model.efforts.length > 0;
  // The active model's badge tracks the chosen effort so the displayed
  // cost reflects the effort-scaled thinking budget; every other row
  // shows its static base multiplier.
  const multiplierText = formatCreditMultiplier(
    isActive && hasEfforts
      ? effectiveCreditMultiplier(model, activeEffort)
      : model.creditMultiplier,
  );
  const contextText = formatContextWindow(model.contextWindow);
  // The flyout opens for every (enabled) row now that it carries a model
  // header; the effort selector is just an optional section within it.
  const hasFlyout = !disabled;

  const {
    flyoutPos,
    flyoutStyle,
    openFlyout,
    scheduleClose,
    clearCloseTimer,
    immediateClose,
  } = useFlyoutAnchor(rowRef, {
    flyoutWidth: FLYOUT_WIDTH,
    enabled: hasFlyout,
    // Close any other row's open flyout before showing ours so only one
    // is ever mounted at a time, then claim the shared slot.
    onBeforeOpen: () => {
      if (closeActiveFlyout && closeActiveFlyout !== selfCloseRef.current) {
        closeActiveFlyout();
      }
      closeActiveFlyout = selfCloseRef.current;
    },
    // Release the shared slot when ours closes, if we still hold it.
    onClose: () => {
      if (closeActiveFlyout === selfCloseRef.current) {
        closeActiveFlyout = null;
      }
    },
  });
  // Mirror the hook's stable close handler into our slot ref after commit
  // (never during render, per `react-hooks/refs`); the module-level
  // coordinator only ever calls it from a later open/close event.
  useEffect(() => {
    selfCloseRef.current = immediateClose;
  });

  const handleRowClick = useCallback(() => {
    if (disabled) return;
    onSelect(model.id);
  }, [disabled, model.id, onSelect]);

  return (
    <div
      className={styles.modelMenuRowWrap}
      data-model-menu-root="true"
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={rowRef}
        type="button"
        disabled={disabled}
        className={`${styles.modelMenuItem} ${isActive ? styles.modelMenuItemActive : ""}`}
        data-agent-model-id={model.id}
        data-agent-model-label={model.label}
        style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
        onClick={handleRowClick}
      >
        <span className={styles.modelMenuItemLabel}>
          {model.label}
          {labelSuffix ?? ""}
        </span>
        <span className={styles.modelMenuItemMeta}>
          {multiplierText ? (
            <span className={styles.modelMultiplier}>{multiplierText}</span>
          ) : null}
          {hasFlyout ? (
            <ChevronRight size={11} className={styles.modelMenuItemChevron} />
          ) : null}
        </span>
      </button>

      {hasFlyout && flyoutPos && typeof document !== "undefined"
        ? createPortal(
            <div
              data-model-menu-root="true"
              className={styles.modelEffortFlyout}
              style={flyoutStyle}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            >
              <div className={styles.modelFlyoutHeader}>
                <span className={styles.modelFlyoutName}>{model.label}</span>
                {multiplierText || contextText ? (
                  <span className={styles.modelFlyoutMeta}>
                    {[multiplierText, contextText].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </div>
              {hasEfforts ? (
                <div className={styles.modelFlyoutEfforts}>
                  {model.efforts!.map((effort) => {
                    const selected = isActive && activeEffort === effort;
                    const effortMultiplier = formatCreditMultiplier(
                      effectiveCreditMultiplier(model, effort),
                    );
                    return (
                      <button
                        key={effort}
                        type="button"
                        className={`${styles.modelEffortOption} ${selected ? styles.modelEffortOptionActive : ""}`}
                        data-agent-effort={effort}
                        onClick={() => onSelect(model.id, effort)}
                      >
                        <span>{EFFORT_LABELS[effort]}</span>
                        {effortMultiplier ? (
                          <span className={styles.modelEffortOptionMultiplier}>
                            {effortMultiplier}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
