import styles from "./BottomTaskbar.module.css";

const GRID_REPO_URL = "https://github.com/cypher-asi/the-grid";
const POWERED_ICON_SIZE = 14;

/**
 * Lightning-bolt outline (lucide `Zap`, v0.475.0) on a 24×24 viewBox.
 * Inlined rather than imported from `lucide-react` so we can paint a
 * second stroked copy on top of the filled glyph and chase a spark
 * along the bolt's real outline.
 */
const BOLT_PATH =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

/**
 * Public-mode-only attribution chip in the bottom taskbar's right
 * cluster. Renders as a real `<a>` (not a `<button>` with an `onClick`
 * navigation) so the standard browser affordances — right-click
 * "Open in new tab", middle-click, copy-link-address, keyboard
 * activation via Enter — all work without us reimplementing them.
 *
 * `target="_blank"` opens the GitHub repo in a new tab; `rel` carries
 * `noopener noreferrer` to prevent the opened page from accessing
 * `window.opener` and to avoid leaking the referrer to GitHub.
 */
export function PoweredByGridButton(): React.ReactElement {
  return (
    <a
      className={styles.poweredByGrid}
      href={GRID_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Powered by THE GRID — opens GitHub in a new tab"
      aria-label="Powered by THE GRID. Opens GitHub in a new tab."
    >
      <svg
        width={POWERED_ICON_SIZE}
        height={POWERED_ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={styles.poweredByGridBolt}
      >
        <path d={BOLT_PATH} className={styles.poweredByGridBoltBase} />
        <path
          d={BOLT_PATH}
          pathLength={100}
          className={styles.poweredByGridBoltSpark}
        />
      </svg>
      <span>
        by <strong>THE GRID</strong>
      </span>
    </a>
  );
}
