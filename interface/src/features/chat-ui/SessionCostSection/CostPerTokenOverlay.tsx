import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Info } from "lucide-react";
import styles from "./SessionCostSection.module.css";

export interface CostPerTokenOverlayProps {
  /** Billed rates in USD per 1M tokens. */
  inputRatePerMillionUsd: number;
  outputRatePerMillionUsd: number;
  cachedRatePerMillionUsd: number;
  /** Formatter shared with the parent so units stay consistent. */
  formatRate: (value: number) => string;
}

/**
 * Click/hover overlay that breaks out the billed per-type rates the
 * "Avg. Cost per Token" figure is averaged from. Presentational: it owns
 * only its own open/close state.
 */
export function CostPerTokenOverlay({
  inputRatePerMillionUsd,
  outputRatePerMillionUsd,
  cachedRatePerMillionUsd,
  formatRate,
}: CostPerTokenOverlayProps): ReactElement {
  // `pinned` (click) and `hovered` are tracked separately so a click
  // that arrives right after the pointer-enter doesn't immediately close
  // the panel (mouse-enter would open, a click-toggle would then close).
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const toggle = useCallback(() => setPinned((prev) => !prev), []);
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") {
      setPinned(false);
      setHovered(false);
    }
  }, []);

  useEffect(() => {
    if (!pinned) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPinned(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pinned]);

  return (
    <span
      ref={wrapperRef}
      className={styles.overlayWrap}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={styles.overlayTrigger}
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-label="Show per-type token rates"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Info size={12} />
      </button>
      {open && (
        <div className={styles.overlayCard} role="dialog" aria-label="Cost per token rates">
          <span className={styles.overlayTitle}>Cost per token (billed, per 1M)</span>
          <div className={styles.overlayRow}>
            <span className={styles.overlayRowLabel}>Input</span>
            <span className={styles.overlayRowValue}>{formatRate(inputRatePerMillionUsd)}</span>
          </div>
          <div className={styles.overlayRow}>
            <span className={styles.overlayRowLabel}>Output</span>
            <span className={styles.overlayRowValue}>{formatRate(outputRatePerMillionUsd)}</span>
          </div>
          <div className={styles.overlayRow}>
            <span className={styles.overlayRowLabel}>Cached (read)</span>
            <span className={styles.overlayRowValue}>{formatRate(cachedRatePerMillionUsd)}</span>
          </div>
          <div className={styles.overlayFooter}>1 Z = $0.01</div>
        </div>
      )}
    </span>
  );
}
