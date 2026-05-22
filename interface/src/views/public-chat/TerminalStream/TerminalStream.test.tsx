/**
 * Behavioural test for `TerminalStream`. Pins three contracts that
 * protect the tool-preview reveal in `MockAuraApp`'s DM windows:
 *
 *   1. At t=0 the stream is empty — no completed lines, no rendered
 *      text from the active line — so consumers can rely on the
 *      preview *not* flashing a fully-populated card before the
 *      stream begins.
 *   2. Characters reveal one at a time within a line, then the
 *      stream advances to the next line after the inter-line delay,
 *      streaming through every line in order until the preview is
 *      complete.
 *   3. While the stream is still progressing a blinking caret is
 *      rendered after the last typed character; once the final line
 *      finishes, the caret stays mounted but is flagged
 *      `data-state="hidden"` so the inline-block keeps contributing
 *      to the line box (unmounting it would subpixel-shift the
 *      trailing line's text by ~1px the moment the stream
 *      resolves — see the caret comment in TerminalStream.module.css
 *      and the parallel fix in `TypewriterText`).
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalStream } from "./TerminalStream";

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalStream", () => {
  it("starts empty before the first character is flushed", () => {
    vi.useFakeTimers();
    render(
      <TerminalStream
        lines={["first", "second"]}
        charSpeedMs={20}
        lineDelayMs={50}
      />,
    );
    expect(screen.queryByText(/first/)).not.toBeInTheDocument();
    expect(screen.queryByText(/second/)).not.toBeInTheDocument();
  });

  it("streams characters then advances line-by-line until complete", () => {
    vi.useFakeTimers();
    render(
      <TerminalStream
        lines={["abc", "de"]}
        charSpeedMs={20}
        lineDelayMs={50}
      />,
    );
    // Run the first line's per-char interval to completion (3 ticks
    // × 20ms = 60ms).
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByText(/abc/)).toBeInTheDocument();
    // Now drain the inter-line pause (50ms) + the second line's
    // per-char interval (2 ticks × 20ms = 40ms) + a small buffer.
    act(() => {
      vi.advanceTimersByTime(110);
    });
    expect(screen.getByText(/abc/)).toBeInTheDocument();
    expect(screen.getByText(/de/)).toBeInTheDocument();
  });

  it("renders a blinking caret while streaming and hides it on completion", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalStream
        lines={["x"]}
        charSpeedMs={20}
        lineDelayMs={50}
      />,
    );
    // Mid-stream — active-line wrapper holds the caret span, which
    // exposes `data-state="blinking"` to make the on/off assertion
    // resilient to hashed CSS module class names.
    const streamingCaret = container.querySelector("pre > span > span");
    expect(streamingCaret).not.toBeNull();
    expect(streamingCaret?.getAttribute("data-state")).toBe("blinking");
    // Drain the single-char line plus the inter-line pause so the
    // stream resolves.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // The caret stays mounted — its inline-block keeps contributing
    // to the line box so the trailing line of text doesn't subpixel-
    // shift ~1px — but flips to `data-state="hidden"`.
    const settledCaret = container.querySelector("pre > span > span");
    expect(settledCaret).not.toBeNull();
    expect(settledCaret?.getAttribute("data-state")).toBe("hidden");
  });

  it("emits hljs-classed tokens when a language is provided", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalStream
        lines={["const x = 1;"]}
        language="typescript"
        charSpeedMs={5}
        lineDelayMs={20}
      />,
    );
    // Drain the entire stream so the line settles into the
    // completed-lines list with its full token set rendered.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // `const` is the standout `hljs-keyword` token in this snippet —
    // its presence proves the highlight path is wired through (the
    // plain-text fallback would never emit any `hljs-*` classes).
    const keywords = container.querySelectorAll("span.hljs-keyword");
    expect(keywords.length).toBeGreaterThan(0);
    expect(
      Array.from(keywords).some((el) => el.textContent === "const"),
    ).toBe(true);
  });

  it("preserves token classification while streaming a partial line", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalStream
        lines={["const x = 1;"]}
        language="typescript"
        charSpeedMs={20}
        lineDelayMs={50}
      />,
    );
    // Stream exactly 3 chars of "const" — enough to land mid-
    // keyword but well short of completion.
    act(() => {
      vi.advanceTimersByTime(60);
    });
    // The visible prefix should already be wrapped in `hljs-keyword`
    // (proves we're clipping a pre-highlighted token tree rather
    // than re-highlighting the raw prefix each tick, which would
    // produce an incorrectly-classified `con` substring).
    const keyword = container.querySelector("span.hljs-keyword");
    expect(keyword).not.toBeNull();
    expect(keyword?.textContent).toBe("con");
  });
});
