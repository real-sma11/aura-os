import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeView } from "./CodeView";

// `ProductScreenSection` reads `window.matchMedia` in its mount effect
// to choose between the animated lightbox transition and a no-op.
// JSDOM doesn't implement it, so install a minimal non-matching stub.
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

function renderCodeView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CodeView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("CodeView", () => {
  it("renders the four product-screen headlines moved off the Agents page", () => {
    renderCodeView();
    for (const headline of [
      /A secure operating system/i,
      /run your company while you sleep/i,
      /improves autonomously/i,
      /agentic processes for every workflow/i,
    ]) {
      expect(
        screen.getByRole("heading", { name: headline }),
      ).toBeInTheDocument();
    }
  });

  it("keeps the shared Download CTA footer linking to /download", () => {
    // `ChangelogPreview` is data-driven (renders nothing until its
    // React Query fetch resolves), so the always-present Download CTA
    // is the stable footer anchor to assert here.
    renderCodeView();
    expect(
      screen.getByRole("link", { name: /DOWNLOAD/i }),
    ).toHaveAttribute("href", "/download");
  });
});
