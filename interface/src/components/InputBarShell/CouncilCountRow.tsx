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
import type { CouncilCount, CouncilMechanism } from "../../stores/chat-ui-store";
import styles from "./InputBarShell.module.css";

export interface CouncilCountRowProps {
  /** Current AURA Council member count (`1` = council off). */
  count: CouncilCount;
  /** Select a new council member count. */
  onSelect: (count: CouncilCount) => void;
  /**
   * Current combine mechanism. Only actionable when the council is
   * active (`count > 1`); the option list is hidden otherwise.
   */
  mechanism: CouncilMechanism;
  /** Select a new combine mechanism. */
  onSelectMechanism: (mechanism: CouncilMechanism) => void;
}

interface MechanismOption {
  value: CouncilMechanism;
  label: string;
  hint: string;
}

// `members[0]` applies the chosen mechanism after every member finishes.
const COUNCIL_MECHANISMS: MechanismOption[] = [
  { value: "synthesize", label: "Synthesize", hint: "one combined answer" },
  { value: "contrast", label: "Contrast", hint: "agree vs disagree" },
  { value: "side_by_side", label: "Side-by-side", hint: "each answer, separate" },
];

interface FlyoutPosition {
  top: number;
  left?: number;
  right?: number;
}

const COUNCIL_COUNTS: CouncilCount[] = [1, 2, 3, 4];
const FLYOUT_WIDTH = 184;
const CLOSE_DELAY_MS = 120;

function countValueLabel(count: CouncilCount): string {
  return count === 1 ? "1x" : `${count}x`;
}

// Subtle billing affordance: council fans the prompt out to `count`
// models and then has slot 0 synthesize, so it costs more than the
// single-model path. Doubles as the lightweight p6 cost hint.
function countCostHint(count: CouncilCount): string {
  return count === 1 ? "1x \u00b7 single model" : `${count} models + synthesizer`;
}

/**
 * Top row of the chat model picker that selects how many AURA Council
 * members run (`1` = council off through `4`). Mirrors
 * {@link import("./ModelMenuRow").ModelMenuRow}'s reasoning-effort
 * flyout mechanics — a `document.body` portal anchored to the row rect,
 * open-on-hover, and a short close delay — because the scrolling
 * `.modelMenu` container clips any sideways child.
 */
export const CouncilCountRow = memo(function CouncilCountRow({
  count,
  onSelect,
  mechanism,
  onSelectMechanism,
}: CouncilCountRowProps) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<FlyoutPosition | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // This row sits at the top of every model picker menu (the single
  // picker and each council slot picker), but only one of those menus is
  // open at a time, so at most one CouncilCountRow is mounted at once.
  // Unlike `ModelMenuRow` no cross-row "single open flyout" coordination
  // is needed — this row just owns its own portal.
  const immediateClose = useCallback(() => {
    clearCloseTimer();
    setFlyoutPos(null);
  }, [clearCloseTimer]);

  const openFlyout = useCallback(() => {
    clearCloseTimer();
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceRight = window.innerWidth - rect.right;
    const pos: FlyoutPosition =
      spaceRight >= FLYOUT_WIDTH + 8
        ? { top: rect.top, left: rect.right + 2 }
        : { top: rect.top, right: window.innerWidth - rect.left + 2 };
    setFlyoutPos(pos);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(immediateClose, CLOSE_DELAY_MS);
  }, [clearCloseTimer, immediateClose]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

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
      data-agent-surface="council-count-row"
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={rowRef}
        type="button"
        className={styles.modelMenuItem}
        data-agent-action="open-council-count"
        data-council-count={count}
        onClick={openFlyout}
      >
        <span className={styles.councilCountLabel}>
          <span className={styles.modelMenuItemLabel}>AURA Council</span>
          <span className={styles.councilCountHint}>{countCostHint(count)}</span>
        </span>
        <span className={styles.modelMenuItemMeta}>
          <span className={styles.councilCountValue}>{countValueLabel(count)}</span>
          <ChevronRight size={11} className={styles.modelMenuItemChevron} />
        </span>
      </button>

      {flyoutPos && typeof document !== "undefined"
        ? createPortal(
            <div
              data-model-menu-root="true"
              className={styles.modelEffortFlyout}
              style={flyoutStyle}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            >
              <div className={styles.modelFlyoutHeader}>
                <span className={styles.modelFlyoutName}>AURA Council</span>
                <span className={styles.modelFlyoutMeta}>
                  More models, higher cost
                </span>
              </div>
              <div className={styles.modelFlyoutEfforts}>
                {COUNCIL_COUNTS.map((n) => {
                  const selected = n === count;
                  return (
                    <button
                      key={n}
                      type="button"
                      className={`${styles.modelEffortOption} ${selected ? styles.modelEffortOptionActive : ""}`}
                      data-council-count-option={n}
                      onClick={() => onSelect(n)}
                    >
                      <span>{`${n}x`}</span>
                      <span className={styles.modelEffortOptionMultiplier}>
                        {n === 1 ? "single model" : `${n} + synth`}
                      </span>
                    </button>
                  );
                })}
              </div>
              {count > 1 ? (
                <div data-agent-surface="council-mechanism">
                  <div className={styles.modelFlyoutHeader}>
                    <span className={styles.modelFlyoutName}>Mechanism</span>
                    <span className={styles.modelFlyoutMeta}>
                      After members finish
                    </span>
                  </div>
                  <div className={styles.modelFlyoutEfforts}>
                    {COUNCIL_MECHANISMS.map((option) => {
                      const selected = option.value === mechanism;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`${styles.modelEffortOption} ${selected ? styles.modelEffortOptionActive : ""}`}
                          data-council-mechanism-option={option.value}
                          onClick={() => onSelectMechanism(option.value)}
                        >
                          <span>{option.label}</span>
                          <span className={styles.modelEffortOptionMultiplier}>
                            {option.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
