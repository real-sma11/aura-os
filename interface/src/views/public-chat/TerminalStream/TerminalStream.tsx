import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import hljs from "highlight.js/lib/common";
import styles from "./TerminalStream.module.css";

interface TerminalStreamProps {
  /** Ordered lines to flush to the preview, one at a time. */
  readonly lines: ReadonlyArray<string>;
  /**
   * Optional `highlight.js` language id (any language registered in
   * `highlight.js/lib/common` — typescript, sql, bash, python, etc.).
   * When set, each preview line is pre-highlighted with hljs and the
   * resulting tokens are revealed char-by-char so a keyword colored
   * at character 1 stays the same colour as the rest of the keyword
   * streams in (no mid-word colour shift). The `hljs-*` class names
   * are global (loaded by `HighlightThemeBridge` from
   * `github-dark.min.css` / `github.min.css`) so light/dark theme
   * colors track the rest of the app for free. When omitted (or
   * when the language is not registered), the component falls back
   * to the plain-text per-char reveal.
   */
  readonly language?: string;
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
 * One flat slice of a highlighted line: a span of `text` with an
 * optional hljs class name. `tokenizeLine` flattens the nested
 * `<span class="...">…</span>` tree from `hljs.highlight().value`
 * into this shape so the renderer can clip after N visible chars
 * without re-parsing HTML on every paint.
 */
interface Token {
  readonly text: string;
  readonly className: string;
}

/**
 * Parse the HTML output of `hljs.highlight(line).value` into a flat
 * array of `{ text, className }` tokens. hljs emits nested spans
 * (e.g. `<span class="hljs-title class_"><span class="hljs-built_in">String</span></span>`)
 * — we walk the DOM and let the innermost element's class win,
 * matching how the github / github-dark stylesheets layer their
 * `.hljs-*` rules. Uses an off-document `<template>` element so the
 * parse doesn't trigger image loads or script execution.
 */
function tokenizeLine(html: string): Token[] {
  if (typeof document === "undefined") {
    // SSR / non-DOM environments — fall through to a single plain
    // text token so the component still renders something sensible
    // (in practice this banner only ever runs in the browser, but
    // the guard keeps the helper safe to call from anywhere).
    return [{ text: html, className: "" }];
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const tokens: Token[] = [];

  const walk = (node: Node, currentClass: string): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      tokens.push({ text: node.textContent ?? "", className: currentClass });
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      // Innermost class wins — passing the current element's class
      // (when it has one) down lets the walk reach a text node
      // tagged with the most specific hljs class on its ancestry
      // path. Falling back to `currentClass` preserves the parent's
      // class for elements without their own className.
      const nextClass = el.className || currentClass;
      for (const child of Array.from(el.childNodes)) {
        walk(child, nextClass);
      }
    }
  };

  for (const child of Array.from(template.content.childNodes)) {
    walk(child, "");
  }

  return tokens;
}

/**
 * Slice a token list to the first `visibleChars` visible characters,
 * preserving each token's class so the rendered prefix stays
 * correctly classified. Used by the renderer to clip the active
 * line on every per-char tick without re-highlighting partial text.
 */
function clipTokens(tokens: ReadonlyArray<Token>, visibleChars: number): Token[] {
  if (visibleChars <= 0) {
    return [];
  }
  let remaining = visibleChars;
  const out: Token[] = [];
  for (const tok of tokens) {
    if (remaining <= 0) break;
    if (tok.text.length <= remaining) {
      out.push(tok);
      remaining -= tok.text.length;
    } else {
      out.push({ text: tok.text.slice(0, remaining), className: tok.className });
      remaining = 0;
    }
  }
  return out;
}

function renderTokens(tokens: ReadonlyArray<Token>): ReactNode {
  return tokens.map((tok, i) =>
    tok.className ? (
      <span key={i} className={tok.className}>
        {tok.text}
      </span>
    ) : (
      <Fragment key={i}>{tok.text}</Fragment>
    ),
  );
}

/**
 * Streams an ordered array of `lines` line-by-line and char-by-char,
 * the way a real terminal flushes stdout: each line types in, the
 * caret rests at end-of-line for a beat, then the next line starts
 * streaming. While the stream is in progress a small block caret
 * hangs off the trailing edge of the currently-typing line so the
 * preview reads as "actively running" rather than pre-rendered.
 *
 * Used by `MockAuraApp`'s DM-window tool frames to make the tool
 * preview feel like the agent's tool is producing output in real time
 * (matching the per-character LLM-stream feel of `TypewriterText`
 * on the message bubbles in the same banner). The inline message
 * typewriter stays a separate component because its layout is
 * inline-text-with-caret, while the terminal preview is a multi-
 * line `<pre>` with monospace font and one rendered child per line.
 *
 * When `language` is provided, the lines are pre-highlighted with
 * `highlight.js` and the resulting tokens are revealed char-by-char
 * (a keyword colored at character 1 stays the same colour as the
 * rest of it streams in — no mid-word colour shift). The hljs class
 * names match the global github / github-dark stylesheet that
 * `HighlightThemeBridge` swaps on theme change, so syntax colors
 * track dark/light mode automatically.
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
 * `MockAuraApp` file comment for the rationale (decorative
 * homepage hero, whole mock app is `aria-hidden`).
 */
export function TerminalStream({
  lines,
  language,
  charSpeedMs = 14,
  lineDelayMs = 90,
}: TerminalStreamProps): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    lineIdx: 0,
    chars: 0,
  });

  // Pre-tokenize each line once per [lines, language] change. When
  // language is omitted (or not registered with hljs) we return null
  // and fall through to the plain-text render path so callers that
  // don't want highlighting pay zero per-render cost.
  const tokenLines = useMemo<ReadonlyArray<ReadonlyArray<Token>> | null>(() => {
    if (!language) return null;
    if (!hljs.getLanguage(language)) return null;
    try {
      return lines.map((line) =>
        tokenizeLine(hljs.highlight(line, { language }).value),
      );
    } catch {
      // hljs throws on malformed input on rare occasions — fall
      // back to plain text rather than crashing the whole banner.
      return null;
    }
  }, [lines, language]);

  useEffect(() => {
    if (lines.length === 0) {
      return;
    }

    // No explicit snapshot reset here: the initial `useState` value
    // is already `{ lineIdx: 0, chars: 0 }`, and the only consumer
    // (`MockAuraApp` DM-window tool frames) mounts this component fresh
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
  const totalLines = lines.length;
  const isComplete = lineIdx >= totalLines;

  // Once the stream completes we keep the final line in the "active"
  // wrapper (with its caret pinned but hidden) instead of moving it
  // into the completed-lines list. Unmounting the inline-block caret
  // would force the line box's baseline strut to recompute without
  // the inline-block contribution, subpixel-shifting the trailing
  // line's text by ~1px the instant the stream resolves. Holding
  // the wrapper mounted across the transition keeps the line stable
  // — see the parallel fix in `TypewriterText` for the same fix on
  // the message-bubble side.
  const completedCount = isComplete
    ? Math.max(totalLines - 1, 0)
    : Math.min(lineIdx, totalLines);
  const activeIdx = isComplete ? totalLines - 1 : lineIdx;
  const activeChars = isComplete ? lines[totalLines - 1]?.length ?? 0 : chars;
  const hasActive = totalLines > 0;

  return (
    <pre className={styles.terminalStream}>
      {lines.slice(0, completedCount).map((line, i) => {
        const lineTokens = tokenLines ? tokenLines[i] : null;
        return (
          <span key={`done-${i}`}>
            {lineTokens ? renderTokens(lineTokens) : line}
            {"\n"}
          </span>
        );
      })}
      {hasActive ? (
        <span key={`active-${activeIdx}`}>
          {tokenLines
            ? renderTokens(clipTokens(tokenLines[activeIdx], activeChars))
            : lines[activeIdx].slice(0, activeChars)}
          <span
            className={`${styles.caret} ${
              isComplete ? styles.caretHidden : ""
            }`}
            data-state={isComplete ? "hidden" : "blinking"}
            aria-hidden="true"
          />
        </span>
      ) : null}
    </pre>
  );
}
