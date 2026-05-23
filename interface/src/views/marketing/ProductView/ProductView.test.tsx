import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
});