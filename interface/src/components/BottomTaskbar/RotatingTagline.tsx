import { useEffect, useState } from "react";
import styles from "./RotatingTagline.module.css";

/**
 * Decorative public-mode chrome text that cycles through the AURA
 * value props one word at a time. Lives in the bottom-left taskbar
 * pill next to the theme toggle (public mode only). Purely
 * presentational, so it is marked `aria-hidden` — screen readers
 * skip the swapping marketing copy rather than announcing a new
 * word every few seconds.
 *
 * Swap motion is a vertical ticker: the outgoing word slides up and
 * out the top while the incoming word slides in from the bottom, the
 * two crossing inside an `overflow: hidden` window. A single `tick`
 * counter drives everything — both layers are keyed on `tick` so
 * each interval remounts them, which replays the CSS slide
 * keyframes cleanly without any teardown bookkeeping.
 */
const TAGLINES = ["Private.", "Secure.", "Decentralized.", "Open Source."] as const;

const ROTATE_MS = 2500;

export function RotatingTagline(): React.ReactElement {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const index = tick % TAGLINES.length;
  const prevIndex = (tick - 1 + TAGLINES.length) % TAGLINES.length;

  return (
    <span className={styles.tagline} aria-hidden="true">
      {tick > 0 ? (
        <span key={`out-${tick}`} className={styles.wordLeaving}>
          {TAGLINES[prevIndex]}
        </span>
      ) : null}
      <span key={`in-${tick}`} className={styles.wordEntering}>
        {TAGLINES[index]}
      </span>
    </span>
  );
}
