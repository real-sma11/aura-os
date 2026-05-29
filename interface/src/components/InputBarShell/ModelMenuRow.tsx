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

const FLYOUT_WIDTH = 132;
const CLOSE_DELAY_MS = 120;

/**
 * One row of the chat model picker. Renders the model label plus a credit
 * multiplier badge, and — for models that declare `efforts` — reveals a
 * reasoning-effort flyout on hover. The flyout is rendered through a
 * `document.body` portal (anchored to the row's bounding rect) because the
 * scrolling `.modelMenu` container clips any sideways child.
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
  const multiplierText = formatCreditMultiplier(model.creditMultiplier);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openFlyout = useCallback(() => {
    if (!hasEfforts) return;
    clearCloseTimer();
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceRight = window.innerWidth - rect.right;
    const pos: FlyoutPosition =
      spaceRight >= FLYOUT_WIDTH + 8
        ? { top: rect.top, left: rect.right + 2 }
        : { top: rect.top, right: window.innerWidth - rect.left + 2 };
    setFlyoutPos(pos);
  }, [clearCloseTimer, hasEfforts]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setFlyoutPos(null), CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

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
          {hasEfforts ? (
            <ChevronRight size={11} className={styles.modelMenuItemChevron} />
          ) : null}
        </span>
      </button>

      {hasEfforts && flyoutPos && typeof document !== "undefined"
        ? createPortal(
            <div
              data-model-menu-root="true"
              className={styles.modelEffortFlyout}
              style={flyoutStyle}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            >
              {model.efforts!.map((effort) => {
                const selected = isActive && activeEffort === effort;
                return (
                  <button
                    key={effort}
                    type="button"
                    className={`${styles.modelEffortOption} ${selected ? styles.modelEffortOptionActive : ""}`}
                    data-agent-effort={effort}
                    onClick={() => onSelect(model.id, effort)}
                  >
                    {EFFORT_LABELS[effort]}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
