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

import { FeedbackDetailsPanel } from "./FeedbackDetailsPanel";
import { useAuthStore } from "../../../stores/auth-store";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackComment, FeedbackItem } from "../types";

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
    useFeedbackStore.setState({
      items: [item],
      comments: [],
      selectedId: "fb-1",
    });
    useAuthStore.setState({ user: null });
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

  it("shows an empty hint when the selected item has no loaded comments", () => {
    render(<FeedbackDetailsPanel />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("renders comments for the selected item, newest first", () => {
    const older: FeedbackComment = {
      id: "c-older",
      itemId: "fb-1",
      author: { name: "Older Author", type: "user" },
      text: "First message",
      createdAt: new Date("2026-04-01T10:00:00Z").toISOString(),
    };
    const newer: FeedbackComment = {
      id: "c-newer",
      itemId: "fb-1",
      author: { name: "Newer Author", type: "user" },
      text: "Second message",
      createdAt: new Date("2026-04-02T10:00:00Z").toISOString(),
    };
    useFeedbackStore.setState({ comments: [older, newer] });

    render(<FeedbackDetailsPanel />);

    const messages = screen.getAllByText(/message/);
    expect(messages.map((node) => node.textContent)).toEqual([
      "Second message",
      "First message",
    ]);
  });

  it("shows a static status tag when the viewer is not the author", () => {
    useFeedbackStore.setState({
      items: [{ ...item, author: { ...item.author, profileId: "other-prof" } }],
    });
    useAuthStore.setState({
      user: {
        user_id: "u-1",
        profile_id: "viewer-prof",
        display_name: "Viewer",
        profile_image: "",
        primary_zid: "",
        zero_wallet: "",
        wallets: [],
      },
    });

    render(<FeedbackDetailsPanel />);
    expect(
      screen.queryByLabelText("Change feedback status"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("In Review")).toBeInTheDocument();
  });

  it("renders a status dropdown only for the submitting author and writes through setStatus", () => {
    const setStatus = vi.fn();
    useFeedbackStore.setState({
      items: [{ ...item, author: { ...item.author, profileId: "author-prof" } }],
      setStatus,
    });
    useAuthStore.setState({
      user: {
        user_id: "u-1",
        profile_id: "author-prof",
        display_name: "Ada Lovelace",
        profile_image: "",
        primary_zid: "",
        zero_wallet: "",
        wallets: [],
      },
    });

    render(<FeedbackDetailsPanel />);
    const select = screen.getByLabelText(
      "Change feedback status",
    ) as HTMLSelectElement;
    expect(select.value).toBe("in_review");

    const options = Array.from(select.options).map((opt) => opt.value);
    expect(options).toEqual(["in_review", "not_started", "done", "deployed"]);

    fireEvent.change(select, { target: { value: "done" } });
    expect(setStatus).toHaveBeenCalledWith("fb-1", "done");
  });

  it("does not duplicate the current status when it is already in the author target list", () => {
    useFeedbackStore.setState({
      items: [
        {
          ...item,
          status: "done",
          author: { ...item.author, profileId: "author-prof" },
        },
      ],
    });
    useAuthStore.setState({
      user: {
        user_id: "u-1",
        profile_id: "author-prof",
        display_name: "Ada Lovelace",
        profile_image: "",
        primary_zid: "",
        zero_wallet: "",
        wallets: [],
      },
    });

    render(<FeedbackDetailsPanel />);
    const select = screen.getByLabelText(
      "Change feedback status",
    ) as HTMLSelectElement;
    const options = Array.from(select.options).map((opt) => opt.value);
    expect(options).toEqual(["done", "not_started", "deployed"]);
  });

  it("ignores comments that belong to a different feedback item", () => {
    const stranger: FeedbackComment = {
      id: "c-other",
      itemId: "fb-other",
      author: { name: "Wrong Item", type: "user" },
      text: "Should not appear",
      createdAt: new Date("2026-04-03T10:00:00Z").toISOString(),
    };
    useFeedbackStore.setState({ comments: [stranger] });

    render(<FeedbackDetailsPanel />);
    expect(screen.queryByText("Should not appear")).not.toBeInTheDocument();
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });
});
