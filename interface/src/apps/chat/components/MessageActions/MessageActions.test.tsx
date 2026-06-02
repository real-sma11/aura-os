import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { MessageActions } from "./MessageActions";
import { registerRegenerateTurn } from "./regenerate-registry";

const createSessionShare = vi.fn();

vi.mock("../../../../shared/api/shares", () => ({
  createSessionShare: (...args: unknown[]) => createSessionShare(...args),
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: [{ project_id: "p1", name: "Demo Project" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "ai1", workspace_path: "/ws/demo" }],
      },
    }),
}));

const STREAM_KEY = "p1:ai1:s1";
const message: DisplaySessionEvent = {
  id: "a1",
  role: "assistant",
  content: "assistant answer",
};

describe("MessageActions", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    createSessionShare.mockReset();
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
  });

  it("creates a share, copies the url, and flips the share button to copied", async () => {
    createSessionShare.mockResolvedValue({
      shareId: "t_abc",
      url: "https://aura.ai/s/t_abc",
    });
    render(<MessageActions message={message} streamKey={STREAM_KEY} />);

    fireEvent.click(screen.getByLabelText("Copy share link"));

    await waitFor(() =>
      expect(createSessionShare).toHaveBeenCalledWith({
        projectId: "p1",
        agentInstanceId: "ai1",
        sessionId: "s1",
      }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://aura.ai/s/t_abc"),
    );
    expect(await screen.findByLabelText("Share link copied")).toBeInTheDocument();
  });

  it("invokes the registered regenerate handler with the message id", () => {
    const regenerate = vi.fn();
    registerRegenerateTurn(STREAM_KEY, regenerate);
    render(<MessageActions message={message} streamKey={STREAM_KEY} />);

    fireEvent.click(screen.getByLabelText("Regenerate response"));
    expect(regenerate).toHaveBeenCalledWith("a1");
  });

  it("opens the details popover and shows the metadata", () => {
    render(<MessageActions message={message} streamKey={STREAM_KEY} />);
    fireEvent.click(screen.getByLabelText("More details"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Demo Project")).toBeInTheDocument();
    expect(screen.getByText("/ws/demo")).toBeInTheDocument();
  });
});
