import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PERSONAS } from "../../public-chat/personas";
import { ProductView } from "./ProductView";

// `ProductScreenSection` calls `window.matchMedia("(prefers-reduced-motion:
// reduce)")` inside its mount effect to decide between the animated lightbox
// transition and a no-op. JSDOM does not implement `matchMedia`, so we install
// a minimal stub before any component mounts. The stub returns a non-matching
// `MediaQueryList`-shaped object and ignores listener registration; the
// production code only reads `matches` and calls `addEventListener` /
// `removeEventListener` (with legacy `addListener` / `removeListener`
// fallbacks).
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
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
  }
});

function renderProductView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ProductView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  // Restore real timers in case a test installed `vi.useFakeTimers()`.
  // Tests that need fake timers opt in per-test; the reset keeps that
  // opt-in from leaking into subsequent suites if a new test forgets
  // to clean up after itself.
  vi.useRealTimers();
});

describe("ProductView", () => {
  it("streams the 'Your Personal Agent.' hero headline via the typewriter", () => {
    // The hero headline now renders through `<TypewriterText />`,
    // which reveals characters on a 45ms interval. The full literal
    // string only appears in the DOM after the interval has run for
    // every character (20 chars × 45ms = 900ms). Advancing fake
    // timers past that threshold flushes the whole stream in a
    // single `act()` tick.
    vi.useFakeTimers();
    renderProductView();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("Your Personal Agent.")).toBeInTheDocument();
  });

  it("places the AgentChatSection directly above the secure-OS row", () => {
    // The agent-chat section anchors the mobile-experience story
    // immediately after the hero, ahead of the desktop OS screenshot
    // row. Asserting the relative DOM order between the section
    // headline and the "A secure operating system..." row headline
    // pins this layout decision without coupling to any internal
    // markup of the surrounding section components — both render
    // their headline as the natural `<h2>` for the section, and the
    // page is a static stack of `<h2>`s today.
    renderProductView();
    const chatSection = screen.getByRole("heading", {
      name: /Chat with your agents/i,
    });
    const secureOsRow = screen.getByRole("heading", {
      name: /A secure operating system/i,
    });
    // `compareDocumentPosition` returns `DOCUMENT_POSITION_FOLLOWING`
    // (bit `0x04`) when the argument node appears AFTER the receiver
    // in document order, which is the order we want here.
    expect(
      chatSection.compareDocumentPosition(secureOsRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("mounts the agent marquee over the hero video with one card per persona", () => {
    // The hero passes `<AgentMarquee />` as `videoOverlay`, so the
    // strip should be present on the rendered ProductView. The
    // marquee duplicates the persona list for the seamless wrap, so
    // we assert at least one card per persona renders (the duplicate
    // count is covered explicitly in `AgentMarquee.test.tsx` —
    // duplicating the assertion here would make a future loop-strategy
    // tweak fail in two places at once for the same reason).
    renderProductView();
    const marquee = screen.getByTestId("agent-marquee");
    for (const persona of PERSONAS) {
      const cards = within(marquee).getAllByRole("img", {
        name: `${persona.name}, ${persona.role}`,
      });
      expect(cards.length).toBeGreaterThanOrEqual(1);
    }
  });
});