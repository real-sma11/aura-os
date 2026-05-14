import { Button } from "@cypher-asi/zui";
import styles from "./StuckStreamPill.module.css";

export interface StuckStreamPillProps {
  /**
   * Wall-clock ms the stream has been considered stuck (i.e. how
   * far past `STUCK_THRESHOLD_MS` the watchdog has measured no
   * fresh wire events). `null` when not stuck — callers should
   * normally not render the pill in that state, but we accept the
   * full `StreamHealth.stuckForMs` shape for ergonomics.
   */
  stuckForMs: number | null;
  onStop: () => void;
  onRetry: () => void;
  onReport: () => void;
}

function formatSeconds(ms: number | null): string {
  if (ms == null || ms < 0) return "0s";
  return `${Math.floor(ms / 1000)}s`;
}

/**
 * Stuck-stream watchdog UI. Replaces the cooking indicator after
 * `STUCK_THRESHOLD_MS` of SSE silence so the user has an explicit
 * Stop / Retry / Report affordance instead of staring at a
 * shimmering "Cooking..." for minutes.
 *
 * Uses `aria-live="polite"` so the announcement reaches screen
 * readers without interrupting whatever the user is currently
 * doing — the pill is a state change, not an emergency.
 */
export function StuckStreamPill({
  stuckForMs,
  onStop,
  onRetry,
  onReport,
}: StuckStreamPillProps) {
  const stuckLabel = formatSeconds(stuckForMs);
  // The watchdog promotes a stream to "stuck" only after
  // STUCK_THRESHOLD_MS (30s) of silence, so the wall-clock age of
  // the last event is roughly stuckForMs + 30s. We compute it
  // here so the pill's secondary copy stays self-contained
  // without having to thread `lastEventAgeMs` separately.
  const ageLabel = formatSeconds((stuckForMs ?? 0) + 30_000);

  return (
    <div
      className={styles.stuckStreamPill}
      aria-live="polite"
      role="status"
    >
      <span className={styles.stuckStreamMessage}>
        Agent paused for {stuckLabel} — last activity was {ageLabel} ago
      </span>
      <div className={styles.stuckStreamActions}>
        <Button variant="ghost" size="sm" onClick={onStop}>
          Stop
        </Button>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
        <Button variant="ghost" size="sm" onClick={onReport}>
          Report
        </Button>
      </div>
    </div>
  );
}
