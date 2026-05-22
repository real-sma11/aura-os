import type { ReactNode } from "react";
import styles from "./TypingIndicator.module.css";

/**
 * Three-dot "agent is typing" indicator with a staggered up/down
 * bounce. Used by `AgentDemoBanner` during the brief beat between a
 * frame becoming the latest row and the row's content (message text
 * or tool card) revealing. The dots animate purely in CSS so the
 * component stays a thin renderer over the agent's accent `color`.
 *
 * The root is marked `aria-hidden` because the bouncing dots convey
 * no information for assistive tech — the surrounding demo loop in
 * `AgentDemoBanner` is already marked decorative for the same
 * reason, and tagging this component independently keeps it safe to
 * lift into a non-decorative surface later without bleeding into the
 * accessibility tree.
 *
 * `prefers-reduced-motion: reduce` pins the dots to a static row at
 * a higher rest opacity (so reduced-motion users still get the "the
 * agent is doing something" signal without the bounce).
 */
interface TypingIndicatorProps {
  /** Agent accent color applied to all three dots. */
  readonly color: string;
}

export function TypingIndicator({ color }: TypingIndicatorProps): ReactNode {
  return (
    <span className={styles.typingDots} aria-hidden="true">
      <span className={styles.typingDot} style={{ background: color }} />
      <span className={styles.typingDot} style={{ background: color }} />
      <span className={styles.typingDot} style={{ background: color }} />
    </span>
  );
}
