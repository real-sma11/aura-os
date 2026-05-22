/**
 * Behavioural test for `TerminalStream`. Pins three contracts that
 * protect the tool-preview reveal in `AgentDemoBanner`:
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
 *      finishes, the caret unmounts so the resolved preview reads
 *      as a static, settled snapshot.
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

  it("renders a caret while streaming and removes it on completion", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalStream
        lines={["x"]}
        charSpeedMs={20}
        lineDelayMs={50}
      />,
    );
    // Mid-stream — active-line wrapper holds the caret span.
    expect(container.querySelector("pre > span > span")).not.toBeNull();
    // Drain the single-char line plus the inter-line pause so the
    // active-line wrapper unmounts.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector("pre > span > span")).toBeNull();
  });
});
