import { useEffect, useState, type ReactNode } from "react";
import styles from "./TypewriterText.module.css";

interface TypewriterTextProps {
  /** Final text to stream into the bubble. */
  readonly text: string;
  /**
   * Milliseconds between character reveals. Defaults to 28ms — about
   * 36 cps, which sits in the same ballpark as a real OpenAI/Anthropic
   * streaming response on a fast connection and is fast enough that
   * the longest message in `SCRIPT` (~60 chars) completes in well
   * under 2 seconds, leaving room to linger before the script
   * advances.
   */
  readonly speedMs?: number;
}

/**
 * Streams `text` one character at a time, mimicking the way LLM
 * responses arrive token-by-token in real chat UIs. While the stream
 * is still progressing a small block caret hangs off the trailing
 * edge of the visible prefix so the bubble reads as "actively being
 * written" rather than truncated; once the full text is on screen
 * the caret disappears.
 *
 * `setInterval` (rather than chained `setTimeout`s) drives the
 * reveal so a single test-time `vi.advanceTimersByTime(N)` flushes
 * the entire stream — chained timeouts only progress one character
 * per `act()` flush because React can't schedule the next timer
 * until the prior state update is committed, which would force every
 * test that touches a message bubble to loop one-tick-at-a-time.
 *
 * `prefers-reduced-motion: reduce` short-circuits the per-character
 * reveal and renders the full text immediately at mount; the CSS
 * layer then hides the caret under the same media query so the
 * resolved bubble looks like a static message. This keeps the
 * informational content identical for reduced-motion users while
 * dropping the streaming animation entirely.
 */
export function TypewriterText({
  text,
  speedMs = 28,
}: TypewriterTextProps): ReactNode {
  const [shown, setShown] = useState<number>(0);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    if (reduceMotion || text.length === 0) {
      setShown(text.length);
      return;
    }

    setShown(0);

    let i = 0;
    const handle = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) {
        clearInterval(handle);
      }
    }, speedMs);
    return () => clearInterval(handle);
  }, [text, speedMs]);

  const isComplete = shown >= text.length;

  return (
    <span className={styles.typewriter}>
      {text.slice(0, shown)}
      {!isComplete ? (
        <span className={styles.caret} aria-hidden="true" />
      ) : null}
    </span>
  );
}
