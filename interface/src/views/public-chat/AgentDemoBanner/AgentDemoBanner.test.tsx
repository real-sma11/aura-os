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
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentDemoBanner } from "./AgentDemoBanner";
import { SCRIPT, type MessageFrame } from "../agent-demo-script";

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

    const firstMessage = SCRIPT.find(
      (frame): frame is MessageFrame => frame.kind === "message",
    );
    if (!firstMessage) {
      throw new Error("expected SCRIPT to contain at least one message frame");
    }
    expect(screen.queryByText(firstMessage.text)).not.toBeInTheDocument();

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

    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const fullText =
      "Let's ship the new pricing page. I'll break it into tasks.";
    expect(screen.queryByText(fullText)).not.toBeInTheDocument();
    expect(screen.getByText(/Let's/)).toBeInTheDocument();
  });

  it("morphs the typing indicator into the resolved message within one row", () => {
    vi.useFakeTimers();

    render(<AgentDemoBanner />);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getAllByText("Architect")).toHaveLength(1);
    expect(
      screen.queryByText(/Let's ship the new pricing page/),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1600);
    });

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
