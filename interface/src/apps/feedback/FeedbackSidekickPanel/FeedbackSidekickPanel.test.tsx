import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));
vi.mock("../FeedbackDetailsPanel", () => ({
  FeedbackDetailsPanel: () => <div data-testid="details-panel">DETAILS</div>,
}));
vi.mock("../FeedbackCommentsPanel", () => ({
  FeedbackCommentsPanel: () => <div data-testid="comments-panel">COMMENTS</div>,
}));

import { FeedbackSidekickPanel } from "./FeedbackSidekickPanel";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackItem } from "../types";

const item: FeedbackItem = {
  id: "fb-1",
  author: { name: "Ada", type: "user" },
  title: "Hotkeys please",
  body: "Cmd+1/2/3",
  category: "feature_request",
  status: "in_review",
  product: "aura",
  upvotes: 0,
  downvotes: 0,
  voteScore: 0,
  viewerVote: "none",
  commentCount: 0,
  createdAt: new Date().toISOString(),
};

describe("FeedbackSidekickPanel", () => {
  beforeEach(() => {
    useFeedbackStore.setState({
      items: [item],
      selectedId: "fb-1",
      sidekickTab: "details",
    });
  });

  it("renders the empty state when nothing is selected, regardless of tab", () => {
    useFeedbackStore.setState({ selectedId: null, sidekickTab: "comments" });
    render(<FeedbackSidekickPanel />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("details-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("comments-panel")).not.toBeInTheDocument();
  });

  it("routes to the details panel by default", () => {
    render(<FeedbackSidekickPanel />);
    expect(screen.getByTestId("details-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("comments-panel")).not.toBeInTheDocument();
  });

  it("routes to the comments panel when the comments tab is active", () => {
    useFeedbackStore.setState({ sidekickTab: "comments" });
    render(<FeedbackSidekickPanel />);
    expect(screen.getByTestId("comments-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("details-panel")).not.toBeInTheDocument();
  });
});
