import { Zap } from "lucide-react";
import styles from "./BottomTaskbar.module.css";

const GRID_REPO_URL = "https://github.com/cypher-asi/the-grid";
const POWERED_ICON_SIZE = 12;

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
 *
 * The leading green dot reads as a "service online" status indicator,
 * signalling that THE GRID is live + healthy. It's a pure decorative
 * affordance — `aria-hidden` so screen readers fall through to the
 * label.
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
      <span className={styles.poweredByGridStatusDot} aria-hidden="true" />
      <Zap
        size={POWERED_ICON_SIZE}
        aria-hidden="true"
        className={styles.poweredByGridBolt}
      />
      <span>
        by <strong>THE GRID</strong>
      </span>
    </a>
  );
}
