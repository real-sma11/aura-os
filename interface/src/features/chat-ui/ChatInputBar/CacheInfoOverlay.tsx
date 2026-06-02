import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Info } from "lucide-react";
import styles from "./ChatInputBar.module.css";

export interface CacheInfoOverlayProps {
  /** Cache-read (reused) tokens this turn. */
  readTokens: number;
  /** Cache-write (creation) tokens this turn. */
  writtenTokens: number;
  /** Formatter shared with the parent so units stay consistent. */
  formatTokens: (value: number | undefined) => string;
}

/**
 * Click/hover overlay that breaks out the per-turn cache read/written
 * token counts the headline "hit %" is derived from. Mirrors the
 * `CostPerTokenOverlay` behavior (separate pinned/hovered state,
 * click-outside dismiss) so the two info popovers feel identical.
 */
export function CacheInfoOverlay({
  readTokens,
  writtenTokens,
  formatTokens,
}: CacheInfoOverlayProps): ReactElement {
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

  const total = readTokens + writtenTokens;

  return (
    <span
      ref={wrapperRef}
      className={styles.cacheOverlayWrap}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={styles.cacheOverlayTrigger}
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-label="Show cache token details"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Info size={12} />
      </button>
      {open && (
        <div
          className={styles.cacheOverlayCard}
          role="dialog"
          aria-label="Cache token details"
        >
          <span className={styles.cacheOverlayTitle}>Cache (this turn)</span>
          <div className={styles.cacheOverlayRow}>
            <span className={styles.cacheOverlayRowLabel}>Read (reused)</span>
            <span className={styles.cacheOverlayRowValue}>{formatTokens(readTokens)}</span>
          </div>
          <div className={styles.cacheOverlayRow}>
            <span className={styles.cacheOverlayRowLabel}>Written</span>
            <span className={styles.cacheOverlayRowValue}>{formatTokens(writtenTokens)}</span>
          </div>
          <div className={styles.cacheOverlayRow}>
            <span className={styles.cacheOverlayRowLabel}>Total</span>
            <span className={styles.cacheOverlayRowValue}>{formatTokens(total)}</span>
          </div>
          <div className={styles.cacheOverlayFooter}>
            Hit % is read tokens over total cache tokens.
          </div>
        </div>
      )}
    </span>
  );
}
