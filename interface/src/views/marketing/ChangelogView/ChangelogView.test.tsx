import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChangelogView } from "./ChangelogView";

function renderChangelogView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ChangelogView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ChangelogView", () => {
  it("renders without throwing and shows the Changelog heading", () => {
    renderChangelogView();
    expect(
      screen.getByRole("heading", { level: 1, name: /Changelog/ }),
    ).toBeInTheDocument();
  });
});