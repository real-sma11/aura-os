import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface StubTabItem {
  id: string;
  title: string;
}
interface StubSidekickTabBarProps {
  tabs: readonly StubTabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

// Stub the real ZUI-backed tab bar so the test stays focused on store wiring
// rather than the overflow/menu measurement logic in `SidekickTabBar`.
vi.mock("../../../components/SidekickTabBar/SidekickTabBar", () => ({
  SidekickTabBar: ({ tabs, activeTab, onTabChange }: StubSidekickTabBarProps) => (
    <div>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-label={tab.title}
          aria-pressed={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.title}
        </button>
      ))}
    </div>
  ),
}));

import { FeedbackSidekickTaskbar } from "./FeedbackSidekickTaskbar";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackItem } from "../types";

const item: FeedbackItem = {
  id: "fb-1",
  author: { name: "Ada", type: "user" },
  title: "Hotkeys please",
  body: "Cmd+1/2/3 across panes",
  category: "feature_request",
  status: "in_review",
  product: "aura",
  upvotes: 4,
  downvotes: 1,
  voteScore: 3,
  viewerVote: "up",
  commentCount: 2,
  createdAt: new Date().toISOString(),
};

describe("FeedbackSidekickTaskbar", () => {
  beforeEach(() => {
    useFeedbackStore.setState({
      items: [item],
      selectedId: "fb-1",
      sidekickTab: "details",
    });
  });

  it("renders nothing when no feedback item is selected", () => {
    useFeedbackStore.setState({ selectedId: null });
    const { container } = render(<FeedbackSidekickTaskbar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists Details and Comments tabs in order", () => {
    render(<FeedbackSidekickTaskbar />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Details",
      "Comments",
    ]);
  });

  it("reflects the current sidekick tab", () => {
    useFeedbackStore.setState({ sidekickTab: "comments" });
    render(<FeedbackSidekickTaskbar />);
    expect(screen.getByRole("button", { name: "Comments" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("flips the store state when the user clicks another tab", () => {
    render(<FeedbackSidekickTaskbar />);
    fireEvent.click(screen.getByRole("button", { name: "Comments" }));
    expect(useFeedbackStore.getState().sidekickTab).toBe("comments");

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(useFeedbackStore.getState().sidekickTab).toBe("details");
  });
});
