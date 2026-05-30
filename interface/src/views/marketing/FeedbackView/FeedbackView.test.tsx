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

  it("renders the summary banner with title, subtitle, and metric labels", () => {
    renderFeedbackView();

    expect(
      screen.getByRole("heading", { level: 1, name: "Feedback" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Our users submit feedback and AURA autonomously improves itself.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Items Submitted")).toBeInTheDocument();
    expect(screen.getByText("Items Resolved")).toBeInTheDocument();
    expect(screen.getByText("Participants")).toBeInTheDocument();
  });
});