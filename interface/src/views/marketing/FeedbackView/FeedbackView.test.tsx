import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackView } from "./FeedbackView";

function renderFeedbackView(initialPath: string = "/feedback") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={queryClient}>
        <FeedbackView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("FeedbackView", () => {
  it("renders the page shell with the filters aside", () => {
    renderFeedbackView();
    expect(
      screen.getByRole("complementary", { name: /Feedback filters/i }),
    ).toBeInTheDocument();
  });
});