/**
 * Behavioural test for the looping `AgentDemoBanner`. Pins four
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
 *   3. A frame with a `typingMs` pre-roll renders the typing
 *      indicator and its resolved message in the *same* row — there
 *      is exactly one "Architect" label visible across the morph,
 *      not two — proving the typing beat is folded into the row
 *      rather than stacked above it as a second entry.
 *   4. The decorative agent loop inside the banner is `aria-hidden`
 *      so screen readers ignore the looping animation and the chat
 *      input below stays the keyboard-reachable surface. The
 *      marketing title at the top of the banner is intentionally
 *      NOT `aria-hidden` so the tagline reaches assistive tech.
 *
 * `prefers-reduced-motion` is intentionally NOT short-circuited at
 * the JS layer (the demo is the entire point of the hero, so freezing
 * it leaves no information value). The CSS layer disables the
 * per-row slide-in, the bubble cross-fade, and the typing-dot bounce
 * under that media query — unit-testing CSS media queries is out of
 * scope for vitest, so we stub `matchMedia` to a non-matching default
 * and let CSS handle the rest in production.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentDemoBanner } from "./AgentDemoBanner";
import { SCRIPT, type MessageFrame } from "./agent-demo-script";

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
      (frame): frame is MessageFrame => frame.kind === "message",
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

  it("morphs the typing indicator into the resolved message within one row", () => {
    vi.useFakeTimers();

    render(<AgentDemoBanner />);

    // The reducer warms up with a 250ms delay before mounting the
    // first frame so the entry animation has a tick to attach.
    // Stepping just past that lands the first frame on screen
    // still in its typing phase (frame 0 declares `typingMs: 700`).
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Mid-typing: the architect's name label is visible exactly
    // once (one row, not two) and the resolved message text has
    // NOT yet replaced the typing dots in the bubble.
    expect(screen.getAllByText("Architect")).toHaveLength(1);
    expect(
      screen.queryByText(/Let's ship the new pricing page/),
    ).not.toBeInTheDocument();

    // Step past the 700ms typing window so the row's bubble swaps
    // from the typing indicator to the resolved text. Total elapsed
    // (1100ms) is well below the frame's total dwell of 2900ms
    // (typingMs 700 + durationMs 2200), so the script has not yet
    // advanced to the second frame and the architect label must
    // still appear exactly once — proving the typing beat lived
    // *inside* the row rather than as a separate stacked entry.
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(
      screen.getByText(/Let's ship the new pricing page/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Architect")).toHaveLength(1);
  });

  it("hides the decorative agent loop from assistive tech via aria-hidden", () => {
    render(<AgentDemoBanner />);

    // Only the looping demo frames are decorative — the marketing
    // title at the top of the banner is content and must remain
    // reachable by assistive tech, so `aria-hidden` lives on the
    // inner loop element rather than the outer banner.
    const decorativeLoop = screen.getByTestId("agent-demo-loop");
    expect(decorativeLoop).toHaveAttribute("aria-hidden", "true");

    const banner = screen.getByTestId("agent-demo-banner");
    expect(banner).not.toHaveAttribute("aria-hidden");
  });

  it("renders the marketing tagline above the agent loop", () => {
    render(<AgentDemoBanner />);

    expect(
      screen.getByText("Coordinate agents while you sleep"),
    ).toBeInTheDocument();
  });
});
