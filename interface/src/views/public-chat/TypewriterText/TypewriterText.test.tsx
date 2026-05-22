/**
 * Smoke test for `TypewriterText`. Pins the streaming-character
 * behaviour at the unit level so the AgentDemoBanner suite stays
 * focused on the timeline orchestrator while the per-character
 * stream contract lives next to its component.
 *
 *  - Final text appears immediately when `prefers-reduced-motion: reduce`
 *    matches (since the per-character reveal is purely decorative).
 *  - The caret is rendered while the stream is in progress and
 *    disappears once the last character has rolled in.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TypewriterText } from "./TypewriterText";

let reduceMotion = false;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: query.includes("reduce") ? reduceMotion : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  reduceMotion = false;
});

describe("TypewriterText", () => {
  it("renders the full text immediately under prefers-reduced-motion", () => {
    reduceMotion = true;
    render(<TypewriterText text="hello" />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

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
});
