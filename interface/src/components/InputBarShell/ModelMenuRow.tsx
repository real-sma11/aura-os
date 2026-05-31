import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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

interface FlyoutPosition {
  top: number;
  left?: number;
  right?: number;
}

const FLYOUT_WIDTH = 184;
const CLOSE_DELAY_MS = 120;

// Only one effort flyout should ever be mounted. Each row registers an
// immediate-close callback here while its flyout is open; opening a new row's
// flyout synchronously closes the previous one so the two portals never
// overlap (which otherwise renders a brief "ghost" of the prior submenu
// during the CLOSE_DELAY_MS window).
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<FlyoutPosition | null>(null);

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

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Synchronously hide this row's flyout and release the shared slot if it
  // belongs to us. Used both by the delayed close and by another row taking
  // over the slot.
  const immediateClose = useCallback(() => {
    clearCloseTimer();
    setFlyoutPos(null);
    if (closeActiveFlyout === immediateCloseRef.current) {
      closeActiveFlyout = null;
    }
  }, [clearCloseTimer]);

  // Keep a stable identity for the slot comparison above even though
  // immediateClose is recreated when its deps change.
  const immediateCloseRef = useRef(immediateClose);
  immediateCloseRef.current = immediateClose;

  const openFlyout = useCallback(() => {
    if (!hasFlyout) return;
    clearCloseTimer();
    // Close any other row's open flyout before showing ours so only one is
    // ever mounted at a time.
    if (closeActiveFlyout && closeActiveFlyout !== immediateCloseRef.current) {
      closeActiveFlyout();
    }
    closeActiveFlyout = immediateCloseRef.current;
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceRight = window.innerWidth - rect.right;
    const pos: FlyoutPosition =
      spaceRight >= FLYOUT_WIDTH + 8
        ? { top: rect.top, left: rect.right + 2 }
        : { top: rect.top, right: window.innerWidth - rect.left + 2 };
    setFlyoutPos(pos);
  }, [clearCloseTimer, hasFlyout]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => immediateCloseRef.current(), CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  useEffect(() => () => immediateCloseRef.current(), []);

  const handleRowClick = useCallback(() => {
    if (disabled) return;
    onSelect(model.id);
  }, [disabled, model.id, onSelect]);

  const flyoutStyle: CSSProperties | undefined = flyoutPos
    ? {
        position: "fixed",
        top: flyoutPos.top,
        ...(flyoutPos.left != null ? { left: flyoutPos.left } : {}),
        ...(flyoutPos.right != null ? { right: flyoutPos.right } : {}),
        zIndex: 10001,
      }
    : undefined;

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
