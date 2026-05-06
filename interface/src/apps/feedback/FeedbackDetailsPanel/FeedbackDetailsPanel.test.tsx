import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));
vi.mock("../../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => (
    <span data-testid="avatar" aria-hidden="true">
      {name.charAt(0)}
    </span>
  ),
}));
vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));

import { FeedbackDetailsPanel } from "./FeedbackDetailsPanel";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackItem } from "../types";

const item: FeedbackItem = {
  id: "fb-1",
  author: { name: "Ada Lovelace", type: "user" },
  title: "Add keyboard shortcuts",
  body: "It would be great to switch panes with Cmd+1, Cmd+2, Cmd+3.\n\nBonus: customizable.",
  category: "feature_request",
  status: "in_review",
  product: "aura",
  upvotes: 7,
  downvotes: 2,
  voteScore: 5,
  viewerVote: "up",
  commentCount: 4,
  createdAt: new Date("2026-04-01T12:00:00Z").toISOString(),
};

describe("FeedbackDetailsPanel", () => {
  beforeEach(() => {
    useFeedbackStore.setState({ items: [item], selectedId: "fb-1" });
  });

  it("prompts the user to select an item when none is selected", () => {
    useFeedbackStore.setState({ selectedId: null });
    render(<FeedbackDetailsPanel />);
    expect(
      screen.getByText("Select a feedback item to view details"),
    ).toBeInTheDocument();
  });

  it("renders the title, full body, and author for the selected item", () => {
    render(<FeedbackDetailsPanel />);
    expect(screen.getByText("Add keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByText(/Cmd\+1, Cmd\+2, Cmd\+3/)).toBeInTheDocument();
    expect(screen.getByText(/Bonus: customizable\./)).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("renders status, category, product, and vote totals", () => {
    render(<FeedbackDetailsPanel />);
    expect(screen.getByText("In Review")).toBeInTheDocument();
    expect(screen.getByText("Feature Request")).toBeInTheDocument();
    expect(screen.getByText("AURA")).toBeInTheDocument();
    expect(screen.getByText(/5 \(7 up · 2 down\)/)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("falls back to an Untitled label when title is empty", () => {
    useFeedbackStore.setState({ items: [{ ...item, title: "" }] });
    render(<FeedbackDetailsPanel />);
    expect(screen.getByRole("heading", { name: "Untitled" })).toBeInTheDocument();
  });
});
