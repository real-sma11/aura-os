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
 * two crossing inside an `overflow: hidden` window.
 */
const TAGLINES = ["Private.", "Secure.", "Decentralized.", "Open Source."] as const;

const ROTATE_MS = 2500;
// Must match the slide keyframe duration in RotatingTagline.module.css
// so the outgoing word is torn down exactly as its animation lands.
const SLIDE_MS = 420;

export function RotatingTagline(): React.ReactElement {
  const [index, setIndex] = useState(0);
  // The word leaving the window (animating up + out). `null` once the
  // slide finishes so the outgoing layer unmounts and stops painting.
  const [outgoing, setOutgoing] = useState<{ word: string; key: number } | null>(
    null,
  );

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((current) => {
        const next = (current + 1) % TAGLINES.length;
        setOutgoing({ word: TAGLINES[current], key: current });
        return next;
      });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const outgoingKey = outgoing?.key;
  useEffect(() => {
    if (outgoingKey == null) return;
    const timer = window.setTimeout(() => {
      setOutgoing((prev) => (prev?.key === outgoingKey ? null : prev));
    }, SLIDE_MS + 40);
    return () => window.clearTimeout(timer);
  }, [outgoingKey]);

  return (
    <span className={styles.tagline} aria-hidden="true">
      {outgoing ? (
        <span key={`out-${outgoing.key}`} className={styles.wordLeaving}>
          {outgoing.word}
        </span>
      ) : null}
      <span key={`in-${index}`} className={styles.wordEntering}>
        {TAGLINES[index]}
      </span>
    </span>
  );
}
