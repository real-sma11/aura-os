import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "../../shared/types";
import { SessionsList } from "./SessionsList";
import type { AnnotatedSession } from "./session-row-utils";

vi.mock("../../api/client", () => ({
  api: {
    summarizeSession: vi.fn().mockResolvedValue({ summary_of_previous_context: "" }),
  },
}));

vi.mock("./SessionsList.module.css", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, prop) => String(prop),
    },
  ),
}));

vi.mock("../EmptyState", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));

vi.mock("../SidekickItemContextMenu", () => ({
  SidekickItemContextMenu: ({ onAction }: { onAction: (id: string) => void }) => (
    <button type="button" data-testid="ctx-delete" onClick={() => onAction("delete")}>
      ctx-delete
    </button>
  ),
  useSidekickItemContextMenu: <T,>({
    resolveItem,
  }: {
    resolveItem: (id: string) => T | null | undefined;
  }) => {
    return {
      menu: null,
      menuRef: { current: null },
      handleContextMenu: () => {},
      closeMenu: () => {},
      __resolve: resolveItem,
    };
  },
}));

function makeSession(
  id: string,
  startedAt: string,
  summary: string,
): AnnotatedSession {
  return {
    session_id: id,
    agent_instance_id: "agent-inst-1",
    project_id: "proj-1",
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: summary,
    status: "completed",
    started_at: startedAt,
    ended_at: null,
    _projectId: "proj-1",
    _projectName: "Project One",
    _agentInstanceId: "agent-inst-1",
  } as Session as AnnotatedSession;
}

const today = new Date();
const isoToday = today.toISOString();
const isoYesterday = new Date(today.getTime() - 86_400_000).toISOString();

describe("SessionsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders date-bucketed rows for sessions with summaries", () => {
    const sessions = [
      makeSession("s1", isoToday, "Refactor sidekick"),
      makeSession("s2", isoYesterday, "Investigate websocket bug"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("Refactor sidekick")).toBeInTheDocument();
    expect(screen.getByText("Investigate websocket bug")).toBeInTheDocument();
  });

  it("hides untitled sessions until a summary is available", () => {
    const sessions = [
      makeSession("s-titled", isoToday, "Has summary"),
      makeSession("s-untitled", isoToday, ""),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Has summary")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /s-untitled/ })).not.toBeInTheDocument();
  });

  it("marks the selected session row with aria-current", () => {
    const sessions = [
      makeSession("s1", isoToday, "First"),
      makeSession("s2", isoToday, "Second"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="s2"
        onSessionClick={vi.fn()}
      />,
    );

    const second = screen.getByRole("button", { name: "Second" });
    expect(second).toHaveAttribute("aria-current", "page");
    const first = screen.getByRole("button", { name: "First" });
    expect(first).not.toHaveAttribute("aria-current");
  });

  it("calls onSessionClick with the clicked session", () => {
    const onClick = vi.fn();
    const sessions = [makeSession("s1", isoToday, "Pick me")];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pick me" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].session_id).toBe("s1");
  });

  it("filters rows by searchQuery (case-insensitive)", () => {
    const sessions = [
      makeSession("s1", isoToday, "Sidekick refactor"),
      makeSession("s2", isoToday, "Websocket bug"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        searchQuery="websocket"
      />,
    );

    expect(screen.queryByText("Sidekick refactor")).not.toBeInTheDocument();
    expect(screen.getByText("Websocket bug")).toBeInTheDocument();
  });

  it("renders the loading state when sessions are empty and loading", () => {
    render(
      <SessionsList
        sessions={[]}
        loading
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading sessions...")).toBeInTheDocument();
  });

  it("renders the empty state when there are no titled sessions", () => {
    render(
      <SessionsList
        sessions={[]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByTestId("empty-state")).toHaveTextContent("No sessions yet");
  });

  it("renders the inline delete-error banner and dismiss button", () => {
    const onDismiss = vi.fn();
    render(
      <SessionsList
        sessions={[makeSession("s1", isoToday, "First")]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        deleteError="Couldn't delete session (409): session has unfinished tasks"
        onDismissError={onDismiss}
      />,
    );

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(
      "Couldn't delete session (409): session has unfinished tasks",
    );
    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the error banner alongside the empty state when there are no sessions", () => {
    render(
      <SessionsList
        sessions={[]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        deleteError="Couldn't delete session (502): aura-storage unreachable"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't delete session (502): aura-storage unreachable",
    );
    expect(screen.getByTestId("empty-state")).toHaveTextContent("No sessions yet");
  });
});
