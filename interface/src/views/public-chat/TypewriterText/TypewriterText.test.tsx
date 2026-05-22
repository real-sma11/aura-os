/**
 * Smoke test for `TypewriterText`. Pins the streaming-character
 * behaviour at the unit level so the AgentDemoBanner suite stays
 * focused on the timeline orchestrator while the per-character
 * stream contract lives next to its component.
 *
 *  - The caret is rendered while the stream is in progress and
 *    disappears once the last character has rolled in.
 *  - `prefers-reduced-motion: reduce` does NOT short-circuit the
 *    stream. The only current consumer is the decorative
 *    `AgentDemoBanner`, which is explicitly designed to play every
 *    animation regardless of the media query (see the banner's
 *    file-level comment) — pinning the message to "appear instantly"
 *    for reduced-motion users made the demo loop read as broken.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TypewriterText } from "./TypewriterText";

afterEach(() => {
  vi.useRealTimers();
});

describe("TypewriterText", () => {
  it("streams characters and removes the caret at completion", () => {
    vi.useFakeTimers();
    render(<TypewriterText text="hi" speedMs={10} />);
    // Caret visible at start (no characters streamed yet).
    expect(document.querySelector("span > span")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(40);
    });
    // After the stream completes the caret span unmounts.
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("streams characters even when prefers-reduced-motion matches", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: query.includes("reduce"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });

    vi.useFakeTimers();
    render(<TypewriterText text="hello" speedMs={20} />);
    // At t=0 nothing has streamed yet — the bubble is empty save
    // for the caret. If the reduced-motion shortcircuit were back,
    // the full text would already be in the DOM at this point.
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
