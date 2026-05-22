import { useEffect, useState, type ReactNode } from "react";
import styles from "./TerminalStream.module.css";

interface TerminalStreamProps {
  /** Ordered lines to flush to the preview, one at a time. */
  readonly lines: ReadonlyArray<string>;
  /**
   * Milliseconds between character reveals within a line. Defaults
   * to 14ms — about 2x the speed of the inline message typewriter
   * (28ms) because real terminal output reads as bursty and a slow
   * crawl makes the tool card overstay its `durationMs` budget on
   * the script's longest preview (~115 chars). 14ms keeps the four-
   * line `bash` build log under 2s, well inside its 2600ms dwell.
   */
  readonly charSpeedMs?: number;
  /**
   * Milliseconds the caret rests at the end of a completed line
   * before the next line starts streaming. Defaults to 90ms — long
   * enough that the cursor visibly settles + blinks once at end-of-
   * line (so each line reads as a discrete "command output" beat),
   * short enough that the rest of the preview catches up before
   * the script advances.
   */
  readonly lineDelayMs?: number;
}

interface Snapshot {
  readonly lineIdx: number;
  readonly chars: number;
}

/**
 * Streams an ordered array of `lines` line-by-line and char-by-char,
 * the way a real terminal flushes stdout: each line types in, the
 * caret rests at end-of-line for a beat, then the next line starts
 * streaming. While the stream is in progress a small block caret
 * hangs off the trailing edge of the currently-typing line so the
 * preview reads as "actively running" rather than pre-rendered.
 *
 * Used by `AgentDemoBanner` tool frames to make the tool preview
 * feel like the agent's tool is producing output in real time
 * (matching the per-character LLM-stream feel of `TypewriterText`
 * on the message bubbles in the same banner). The inline message
 * typewriter stays a separate component because its layout is
 * inline-text-with-caret, while the terminal preview is a multi-
 * line `<pre>` with monospace font and one rendered child per line
 * — sharing a single component would force one side to fight the
 * other's display model.
 *
 * Driven by a single `useEffect` per `lines` prop that holds the
 * entire streaming state in closure (`lineIdx` / `chars` locals) and
 * publishes snapshots to React via `setSnapshot` for re-renders.
 * Keeping the per-char state out of the effect's dep list is what
 * lets `vi.advanceTimersByTime(N)` in tests flush multiple chars
 * (and multiple lines) in a single call — if the effect re-ran on
 * every char it would clear and recreate the interval mid-stream
 * and React's batching could leave the next interval scheduled past
 * the timer-advance window.
 *
 * Like its sibling `TypewriterText`, this component intentionally
 * does NOT honour `prefers-reduced-motion: reduce` — see the
 * `AgentDemoBanner` file comment for the rationale (decorative
 * homepage hero, whole banner is `aria-hidden`).
 */
export function TerminalStream({
  lines,
  charSpeedMs = 14,
  lineDelayMs = 90,
}: TerminalStreamProps): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    lineIdx: 0,
    chars: 0,
  });

  useEffect(() => {
    // Empty `lines` is a no-op — the initial `useState` snapshot
    // ({ lineIdx: 0, chars: 0 }) already renders an empty preview
    // with no caret, since `isComplete = lineIdx >= lines.length`
    // is true when both are zero. Returning early avoids a dead
    // `setSnapshot` reset (which the react-hooks lint correctly
    // flags as a cascading sync set-state-in-effect).
    if (lines.length === 0) {
      return;
    }

    // No explicit snapshot reset here: the initial `useState` value
    // is already `{ lineIdx: 0, chars: 0 }`, and the only consumer
    // (`AgentDemoBanner` tool frames) mounts this component fresh
    // inside a phase-keyed wrapper, so the snapshot is guaranteed
    // to start at the correct empty state. A sync `setSnapshot` at
    // the top of the effect would correctly reset if `lines` ever
    // changes mid-mount but the react-hooks lint flags it as a
    // cascading set-state-in-effect, and the case it would handle
    // doesn't occur in practice (lines come from a constant SCRIPT).
    let lineIdx = 0;
    let chars = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    let advance: ReturnType<typeof setTimeout> | null = null;

    const scheduleAdvance = (): void => {
      advance = setTimeout(() => {
        advance = null;
        lineIdx += 1;
        chars = 0;
        if (lineIdx >= lines.length) {
          // Publish a terminal snapshot (lineIdx past the end so
          // the consumer can detect completion and unmount the
          // caret). No more timers scheduled — stream is done.
          setSnapshot({ lineIdx, chars: 0 });
          return;
        }
        setSnapshot({ lineIdx, chars: 0 });
        startLine();
      }, lineDelayMs);
    };

    const startLine = (): void => {
      const currentLine = lines[lineIdx];

      if (currentLine.length === 0) {
        // Empty line — no chars to stream, jump straight to the
        // inter-line pause so blank rows still pace through the
        // preview as discrete beats rather than vanishing.
        scheduleAdvance();
        return;
      }

      interval = setInterval(() => {
        chars += 1;
        setSnapshot({ lineIdx, chars });
        if (chars >= currentLine.length) {
          if (interval !== null) {
            clearInterval(interval);
            interval = null;
          }
          scheduleAdvance();
        }
      }, charSpeedMs);
    };

    startLine();

    return () => {
      if (interval !== null) {
        clearInterval(interval);
      }
      if (advance !== null) {
        clearTimeout(advance);
      }
    };
  }, [lines, charSpeedMs, lineDelayMs]);

  const { lineIdx, chars } = snapshot;
  const isComplete = lineIdx >= lines.length;
  const completed = lines.slice(0, lineIdx);
  const activeText = !isComplete ? lines[lineIdx].slice(0, chars) : "";

  return (
    <pre className={styles.terminalStream}>
      {completed.map((line, i) => (
        <span key={`done-${i}`}>{`${line}\n`}</span>
      ))}
      {!isComplete ? (
        <span key={`active-${lineIdx}`}>
          {activeText}
          <span className={styles.caret} aria-hidden="true" />
        </span>
      ) : null}
    </pre>
  );
}
