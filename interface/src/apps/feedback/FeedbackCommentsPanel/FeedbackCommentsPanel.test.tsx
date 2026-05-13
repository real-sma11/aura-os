import { fireEvent, render, screen } from "@testing-library/react";
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

import { FeedbackCommentsPanel } from "./FeedbackCommentsPanel";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackComment, FeedbackItem } from "../types";

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

const comment: FeedbackComment = {
  id: "c-1",
  itemId: "fb-1",
  author: { name: "Grace", type: "user" },
  text: "Nice idea",
  createdAt: new Date().toISOString(),
};

describe("FeedbackCommentsPanel", () => {
  beforeEach(() => {
    useFeedbackStore.setState({
      items: [item],
      comments: [],
      selectedId: null,
    });
  });

  it("prompts the user to pick a feedback item when none is selected", () => {
    render(<FeedbackCommentsPanel />);
    expect(
      screen.getByText("Select a feedback item to view comments"),
    ).toBeInTheDocument();
  });

  it("shows 'No comments yet' when the selected item has none", () => {
    useFeedbackStore.setState({ selectedId: "fb-1" });
    render(<FeedbackCommentsPanel />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("renders existing comments for the selected item", () => {
    useFeedbackStore.setState({ selectedId: "fb-1", comments: [comment] });
    render(<FeedbackCommentsPanel />);
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Nice idea")).toBeInTheDocument();
  });

  it("renders comments newest first regardless of store order", () => {
    const older: FeedbackComment = {
      id: "c-older",
      itemId: "fb-1",
      author: { name: "Older", type: "user" },
      text: "First message",
      createdAt: new Date("2026-04-01T10:00:00Z").toISOString(),
    };
    const newer: FeedbackComment = {
      id: "c-newer",
      itemId: "fb-1",
      author: { name: "Newer", type: "user" },
      text: "Second message",
      createdAt: new Date("2026-04-02T10:00:00Z").toISOString(),
    };
    useFeedbackStore.setState({ selectedId: "fb-1", comments: [older, newer] });

    render(<FeedbackCommentsPanel />);

    const messages = screen.getAllByText(/message/);
    expect(messages.map((node) => node.textContent)).toEqual([
      "Second message",
      "First message",
    ]);
  });

  it("calls addComment through the store on Enter and clears the draft", () => {
    const addComment = vi.fn();
    useFeedbackStore.setState({ selectedId: "fb-1", addComment });

    render(<FeedbackCommentsPanel />);
    const textarea = screen.getByLabelText("Add a comment") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "LGTM" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(addComment).toHaveBeenCalledWith("fb-1", "LGTM");
    expect(textarea.value).toBe("");
  });

  it("keeps the send button disabled until there is non-whitespace text", () => {
    useFeedbackStore.setState({ selectedId: "fb-1" });
    render(<FeedbackCommentsPanel />);
    const send = screen.getByLabelText("Send comment") as HTMLButtonElement;
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "   " },
    });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "done" },
    });
    expect(send).not.toBeDisabled();
  });
});
