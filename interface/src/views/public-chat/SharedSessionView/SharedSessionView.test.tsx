import { describe, it, expect, vi, beforeEach } from "vitest";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders, screen } from "../../../test/render";
import { SharedSessionView } from "./SharedSessionView";
import { ShareNotFoundError } from "../../../shared/api/shares";
import type { SessionEvent } from "../../../shared/types";

const getPublicShareMock = vi.fn();

vi.mock("../../../shared/api/shares", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../shared/api/shares")>();
  return {
    ...actual,
    getPublicShare: (token: string) => getPublicShareMock(token),
  };
});

// Stub the heavy `LLMOutput` renderer so the test stays focused on the
// view's load states rather than the markdown / activity-timeline stack.
vi.mock("../../../apps/chat/components/LLMOutput", () => ({
  LLMOutput: ({ content }: { content: string }) => (
    <div data-testid="llm-output">{content}</div>
  ),
}));

const TOKEN = "t_6a1e3d8f6e548191948c1f0a9c68cbda";

const transcript: SessionEvent[] = [
  {
    event_id: "e1",
    agent_instance_id: "a1",
    project_id: "p1",
    role: "user",
    content: "Hello there",
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    event_id: "e2",
    agent_instance_id: "a1",
    project_id: "p1",
    role: "assistant",
    content: "General Kenobi",
    created_at: "2024-01-01T00:00:01Z",
  },
];

function renderAt(path: string): void {
  renderWithProviders(
    <Routes>
      <Route path="/s/:shareToken" element={<SharedSessionView />} />
    </Routes>,
    { routerProps: { initialEntries: [path] } },
  );
}

describe("SharedSessionView", () => {
  beforeEach(() => {
    getPublicShareMock.mockReset();
  });

  it("renders the loading state then the transcript on success", async () => {
    let resolve: (value: SessionEvent[]) => void = () => {};
    getPublicShareMock.mockReturnValue(
      new Promise<SessionEvent[]>((r) => {
        resolve = r;
      }),
    );

    renderAt(`/s/${TOKEN}`);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    resolve(transcript);

    expect(await screen.findByText("Hello there")).toBeInTheDocument();
    expect(screen.getByText("General Kenobi")).toBeInTheDocument();
    expect(getPublicShareMock).toHaveBeenCalledWith(TOKEN);
  });

  it("renders a not-found state when the share is missing", async () => {
    getPublicShareMock.mockRejectedValue(new ShareNotFoundError());

    renderAt(`/s/${TOKEN}`);

    expect(
      await screen.findByText(/share link is unavailable/i),
    ).toBeInTheDocument();
  });

  it("treats a malformed token as not-found without fetching", async () => {
    renderAt("/s/not-a-real-token");

    expect(
      await screen.findByText(/share link is unavailable/i),
    ).toBeInTheDocument();
    expect(getPublicShareMock).not.toHaveBeenCalled();
  });
});
