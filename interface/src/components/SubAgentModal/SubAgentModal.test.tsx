import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DisplaySessionEvent } from "../../shared/types/stream";
import { SubAgentModal } from "./SubAgentModal";

const mockUseSubagentChatStream = vi.hoisted(() => vi.fn());
const mockUseStreamEvents = vi.hoisted(() => vi.fn());
const mockUseIsStreaming = vi.hoisted(() => vi.fn());

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    subtitle,
    headerActions,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    subtitle?: string;
    headerActions?: ReactNode;
    children?: ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h1>{title}</h1>
        {subtitle ? <p data-testid="modal-subtitle">{subtitle}</p> : null}
        <div data-testid="modal-header-actions">{headerActions}</div>
        {children}
      </div>
    ) : null,
  Badge: ({ children }: { children?: ReactNode }) => (
    <span data-testid="badge">{children}</span>
  ),
  Spinner: () => <div data-testid="spinner" />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../features/chat-ui/ChatPanel", () => ({
  ChatPanel: ({
    streamKey,
    transcriptKey,
    sendDisabled,
  }: {
    streamKey: string;
    transcriptKey?: string;
    sendDisabled?: boolean;
  }) => (
    <div
      data-testid="chat-panel"
      data-stream-key={streamKey}
      data-transcript-key={transcriptKey}
      data-send-disabled={String(!!sendDisabled)}
    />
  ),
}));

vi.mock("../../hooks/use-subagent-chat-stream", () => ({
  subagentStreamKey: (childRunId: string) => `subagent:${childRunId}`,
  useSubagentChatStream: (...args: unknown[]) => mockUseSubagentChatStream(...args),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useStreamEvents: (...args: unknown[]) => mockUseStreamEvents(...args),
  useIsStreaming: (...args: unknown[]) => mockUseIsStreaming(...args),
}));

const transcript: DisplaySessionEvent[] = [
  { id: "evt-1", role: "assistant", content: "Investigated the codebase" },
];

const baseProps = {
  onClose: () => {},
  childRunId: "child-1",
  parentToolUseId: "tool-1",
  subagentType: "explore",
  prompt: "Explore the repo",
  state: "running" as const,
};

describe("SubAgentModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseStreamEvents.mockReturnValue(transcript);
    mockUseIsStreaming.mockReturnValue(false);
    mockUseSubagentChatStream.mockReturnValue({
      streamKey: "subagent:child-1",
      status: "live",
    });
  });

  it("renders the reused chat surface pointed at the child run's partition", () => {
    render(<SubAgentModal {...baseProps} isOpen />);

    const panel = screen.getByTestId("chat-panel");
    expect(panel.getAttribute("data-stream-key")).toBe("subagent:child-1");
    expect(panel.getAttribute("data-transcript-key")).toBe("subagent:child-1");
    // The child run has no inbound message path, so sending is disabled.
    expect(panel.getAttribute("data-send-disabled")).toBe("true");
  });

  it("keeps rendering the same chat surface across close and reopen", () => {
    const { rerender } = render(<SubAgentModal {...baseProps} isOpen />);
    expect(screen.getByTestId("chat-panel").getAttribute("data-stream-key")).toBe(
      "subagent:child-1",
    );

    // Close.
    rerender(<SubAgentModal {...baseProps} isOpen={false} />);
    expect(screen.queryByTestId("chat-panel")).toBeNull();

    // Reopen: the transcript still resolves from the persisted partition,
    // so the same chat surface comes back.
    rerender(<SubAgentModal {...baseProps} isOpen />);
    expect(screen.getByTestId("chat-panel").getAttribute("data-stream-key")).toBe(
      "subagent:child-1",
    );
  });

  it("shows the connecting state before any transcript arrives", () => {
    mockUseStreamEvents.mockReturnValue([]);
    mockUseIsStreaming.mockReturnValue(false);
    mockUseSubagentChatStream.mockReturnValue({
      streamKey: "subagent:child-1",
      status: "attaching",
    });

    render(<SubAgentModal {...baseProps} isOpen />);
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("shows the unavailable state when the attach failed with no transcript", () => {
    mockUseStreamEvents.mockReturnValue([]);
    mockUseSubagentChatStream.mockReturnValue({
      streamKey: "subagent:child-1",
      status: "error",
      errorMessage: "gone",
    });

    render(<SubAgentModal {...baseProps} isOpen />);
    expect(
      screen.getByText("This subagent thread is no longer available."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("surfaces the failure reason for a terminal failed run", () => {
    render(
      <SubAgentModal
        {...baseProps}
        isOpen
        state="rejected"
        reason="Subagent depth limit reached"
      />,
    );
    expect(screen.getByText("Subagent depth limit reached")).toBeInTheDocument();
  });
});
