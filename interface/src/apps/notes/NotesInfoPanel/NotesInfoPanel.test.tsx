import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));

import { NotesInfoPanel } from "./NotesInfoPanel";
import { useNotesStore, makeNoteKey } from "../../../stores/notes-store";
import { useAuthStore } from "../../../stores/auth-store";

function seedActiveNote(content: string, createdBy: string = "Ada") {
  const projectId = "proj-1";
  const noteId = "note-1";
  const key = makeNoteKey(projectId, noteId);
  useNotesStore.setState({
    activeProjectId: projectId,
    activeNoteId: noteId,
    contentCache: {
      [key]: {
        content,
        title: "Big Ideas",
        note: {
          id: noteId,
          projectId,
          title: "Big Ideas",
          status: "draft",
          authorName: createdBy,
          createdBy,
          createdAt: "2025-04-10T12:00:00.000Z",
        },
        updatedAt: "2025-04-11T09:00:00.000Z",
        wordCount: 42,
        dirty: false,
      },
    },
  });
}

describe("NotesInfoPanel", () => {
  beforeEach(() => {
    useNotesStore.setState({
      activeProjectId: null,
      activeNoteId: null,
      contentCache: {},
    });
  });

  it("renders a quiet placeholder when no note is active", () => {
    const { container } = render(<NotesInfoPanel />);
    expect(container.querySelector("button")).toBeNull();
    expect(screen.queryByText(/Word count/)).not.toBeInTheDocument();
  });

  it("renders title, created-at/by, word count, and status rows", () => {
    seedActiveNote("# Top\n\nbody");

    render(<NotesInfoPanel />);

    expect(screen.getByText("Big Ideas")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();

    expect(screen.getByText("Created at")).toBeInTheDocument();
    expect(screen.getByText("Created by")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    // No filesystem location row in the storage-backed info panel.
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
    // TOC moved to its own panel; nothing TOC-related should render here.
    expect(screen.queryByText("Table of contents")).not.toBeInTheDocument();
    expect(screen.queryByText("No headings yet")).not.toBeInTheDocument();
  });

  it("resolves a UUID created_by to the current user's display name", () => {
    const selfId = "11111111-2222-3333-4444-555555555555";
    useAuthStore.setState({
      user: {
        user_id: selfId,
        display_name: "Rainer",
        profile_image: "",
        primary_zid: "",
        zero_wallet: "",
        wallets: [],
        is_zero_pro: false,
        is_access_granted: false,
      },
    });
    seedActiveNote("# Top", selfId);
    render(<NotesInfoPanel />);
    expect(screen.getByText("Rainer")).toBeInTheDocument();
    expect(screen.queryByText(selfId)).not.toBeInTheDocument();
  });
});
