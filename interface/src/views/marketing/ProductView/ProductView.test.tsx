import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
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

describe("ProductView", () => {
  it("renders the 'Your Personal Agent.' hero headline", () => {
    renderProductView();
    expect(screen.getByText(/Your Personal Agent\./)).toBeInTheDocument();
  });
});