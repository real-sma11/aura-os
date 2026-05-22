/**
 * Behavioural test for the looping `AgentDemoBanner`. Pins five
 * contracts that protect both the visual hero on the public homepage
 * and the accessibility behaviour around the decorative animation:
 *
 *   1. The banner mounts empty — the scripted timeline drives in via
 *      `setTimeout`, not eager render — so the first paint never
 *      flashes a fully-populated hero before the animation begins.
 *   2. As fake timers advance, scripted frames fill in one at a time
 *      and the architect's first message text fully streams in;
 *      this demonstrates that script playback AND the per-character
 *      typewriter are both wired to cancellable timers rather than
 *      mounted eagerly.
 *   3. Message text reveals one character at a time after the typing
 *      pre-roll — at a point in the content phase where only a few
 *      ms have elapsed, the bubble contains a strict prefix of the
 *      final copy rather than the whole message, proving the
 *      typewriter is actually rolling characters in.
 *   4. A frame with a `typingMs` pre-roll renders the typing
 *      indicator and its resolved message in the *same* row — there
 *      is exactly one "Architect" label visible across the morph,
 *      not two — proving the typing beat is folded into the row
 *      rather than stacked above it as a second entry.
 *   5. The decorative agent loop inside the banner is `aria-hidden`
 *      so screen readers ignore the looping animation and the chat
 *      input below stays the keyboard-reachable surface. The
 *      marketing title at the top of the banner is intentionally
 *      NOT `aria-hidden` so the tagline reaches assistive tech.
 *
 * `prefers-reduced-motion` is intentionally NOT short-circuited at
 * the timeline layer (the demo is the entire point of the hero, so
 * freezing it leaves no information value). The CSS layer disables
 * the per-row slide-in, the bubble cross-fade, the typing-dot
 * bounce, and the caret blink under that media query, and
 * `TypewriterText` itself reads the media query at mount and skips
 * the per-character reveal — unit-testing CSS media queries is out
 * of scope for vitest, so we stub `matchMedia` to a non-matching
 * default and let CSS / the component handle the rest in production.
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

  it("streams the resolved message text one character at a time", () => {
    vi.useFakeTimers();

    render(<AgentDemoBanner />);

    // Each scripted state change is driven by a `setTimeout` that
    // only re-arms after React has flushed the prior state update,
    // so reaching the typewriter stream requires three separate
    // `act()` flushes: the reducer advance (warm-up), the typing
    // pre-roll, and the typewriter's own interval ticks.
    //
    // act 1: 250ms reducer warm-up dispatches the first advance and
    // mounts frame 0 in its `typing` phase.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // act 2: step past the 700ms typing window so the row's phase
    // flips to `content`; the bubble remounts and the typewriter
    // schedules its interval but hasn't fired a tick yet.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // act 3: roll the typewriter for ~300ms (~10 ticks at 28ms each)
    // so a strict prefix of the message is on screen.
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const fullText =
      "Let's ship the new pricing page. I'll break it into tasks.";
    expect(screen.queryByText(fullText)).not.toBeInTheDocument();
    // A short prefix is visible — proves characters are actively
    // rolling in rather than the bubble being empty or the whole
    // message being dumped at once.
    expect(screen.getByText(/Let's/)).toBeInTheDocument();
  });

  it("morphs the typing indicator into the resolved message within one row", () => {
    vi.useFakeTimers();

    render(<AgentDemoBanner />);

    // act 1: the reducer's 250ms warm-up mounts frame 0 in its
    // typing phase. The architect's name label is visible exactly
    // once (one row, not two) and the resolved message text has
    // NOT yet replaced the typing dots in the bubble.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getAllByText("Architect")).toHaveLength(1);
    expect(
      screen.queryByText(/Let's ship the new pricing page/),
    ).not.toBeInTheDocument();

    // act 2: step past the 700ms typing window so the row's bubble
    // swaps from typing dots to the streaming-message variant. The
    // typewriter mounts inside the same row.
    act(() => {
      vi.advanceTimersByTime(800);
    });

    // act 3: let the per-character typewriter complete (~1.6s for
    // the 58-char first line at 28ms/char). Total elapsed (2800ms)
    // is still below the frame's full dwell of 2900ms (typingMs 700
    // + durationMs 2200), so the script has not yet advanced to the
    // second frame and the architect label must still appear
    // exactly once — proving the typing beat lived *inside* the row
    // rather than as a separate stacked entry above the message.
    act(() => {
      vi.advanceTimersByTime(1700);
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
