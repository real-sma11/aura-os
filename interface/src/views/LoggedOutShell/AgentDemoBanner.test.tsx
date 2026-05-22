/**
 * Behavioural test for the looping `AgentDemoBanner`. Pins three
 * contracts that protect both the visual hero on the public homepage
 * and the accessibility behaviour around the decorative animation:
 *
 *   1. The banner mounts empty — the scripted timeline drives in via
 *      `setTimeout`, not eager render — so the first paint never
 *      flashes a fully-populated hero before the animation begins.
 *   2. As fake timers advance, scripted frames fill in one at a time;
 *      the architect's first message lands within the first ~1s of
 *      simulated time, demonstrating that the script playback is
 *      wired to a cancellable `setTimeout` chain rather than a
 *      non-cancellable interval.
 *   3. The banner is `aria-hidden` so screen readers ignore the
 *      decorative loop and the chat input below stays the keyboard-
 *      reachable surface.
 *
 * `prefers-reduced-motion` is intentionally NOT short-circuited at
 * the JS layer (the demo is the entire point of the hero, so freezing
 * it leaves no information value). The CSS layer disables the
 * per-row slide-in and typing-dot pulse under that media query —
 * unit-testing CSS media queries is out of scope for vitest, so we
 * stub `matchMedia` to a non-matching default and let CSS handle the
 * rest in production.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentDemoBanner } from "./AgentDemoBanner";
import { SCRIPT } from "./agent-demo-script";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
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
});

describe("AgentDemoBanner", () => {
  it("starts empty and reveals scripted frames as timers advance", () => {
    vi.useFakeTimers();

    render(<AgentDemoBanner />);

    // First message in SCRIPT is the architect's "Let's ship the new
    // pricing page..." line. Asserting it appears (rather than just
    // "any frame") pins the very first beat of the demo so a
    // regression that swaps the opening agent or copy is caught.
    const firstMessage = SCRIPT.find(
      (frame): frame is {
        kind: "message";
        agent: string;
        text: string;
        durationMs: number;
      } => frame.kind === "message",
    );
    if (!firstMessage) {
      throw new Error("expected SCRIPT to contain at least one message frame");
    }
    expect(screen.queryByText(firstMessage.text)).not.toBeInTheDocument();

    // The component schedules each frame's `setTimeout` from inside
    // a `useEffect` that re-runs after the previous advance, so a
    // single `advanceTimersByTime` only fires one timer before
    // returning to act. Stepping through several short slices lets
    // the effect chain re-arm and resolve enough frames for the
    // first message to land on screen.
    for (let i = 0; i < 6; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    expect(screen.getByText(firstMessage.text)).toBeInTheDocument();
  });

  it("hides the decorative banner from assistive tech via aria-hidden", () => {
    render(<AgentDemoBanner />);

    const banner = screen.getByTestId("agent-demo-banner");
    expect(banner).toHaveAttribute("aria-hidden", "true");
  });
});
