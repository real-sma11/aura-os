import { useEffect, useState } from "react";
import styles from "./RotatingTagline.module.css";

/**
 * Decorative public-mode chrome text that cycles through the AURA
 * value props one word at a time. Lives in the bottom-left taskbar
 * pill next to the theme toggle (public mode only). Purely
 * presentational, so it is marked `aria-hidden` — screen readers
 * skip the swapping marketing copy rather than announcing a new
 * word every few seconds.
 */
const TAGLINES = ["Private.", "Secure.", "Decentralized.", "Open Source."] as const;

const ROTATE_MS = 2500;

export function RotatingTagline(): React.ReactElement {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % TAGLINES.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={styles.tagline} aria-hidden="true">
      {/*
       * Keyed on the active word so React remounts the span on every
       * swap, re-triggering the fade-in keyframe. A fixed min-width on
       * the wrapper keeps the pill from reflowing as the words change
       * length.
       */}
      <span key={TAGLINES[index]} className={styles.word}>
        {TAGLINES[index]}
      </span>
    </span>
  );
}
