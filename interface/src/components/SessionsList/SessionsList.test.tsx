import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "../../shared/types";
import { SessionsList } from "./SessionsList";
import type { AnnotatedSession } from "./session-row-utils";

vi.mock("../../api/client", () => ({
  api: {
    summarizeSession: vi.fn().mockResolvedValue({ summary_of_previous_context: "" }),
  },
}));

// The Explorer mock honors *both* the controlled `selectedIds` prop
// (what `SessionsList` actually uses) and `defaultSelectedIds` for
// any future callers — and it intentionally does *not* manage its
// own selection state, so a "click then re-render with the same
// `selectedIds`" path correctly leaves the row unselected (the
// real ZUI Explorer's controlled mode behaves the same way).
vi.mock("@cypher-asi/zui", () => ({
  Explorer: ({
    data,
    selectedIds,
    defaultSelectedIds = [],
    onSelect,
  }: {
    data: Array<{ id: string; label: string }>;
    selectedIds?: string[];
    defaultSelectedIds?: string[];
    onSelect?: (ids: string[]) => void;
  }) => {
    const effectiveSelected = selectedIds ?? defaultSelectedIds;
    return (
      <div role="tree">
        {data.map((node) => {
          const selected = effectiveSelected.includes(node.id);
          return (
            <button
              key={node.id}
              type="button"
              id={node.id}
              role="treeitem"
              aria-current={selected ? "page" : undefined}
              aria-selected={selected}
              onClick={() => onSelect?.([node.id])}
            >
              {node.label}
            </button>
          );
        })}
      </div>
    );
  },
}));

import { api } from "../../api/client";

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
    expect(screen.queryByRole("treeitem", { name: /s-untitled/ })).not.toBeInTheDocument();
  });

  it("retries summary generation after an empty first response", async () => {
    vi.useFakeTimers();
    vi.mocked(api.summarizeSession)
      .mockResolvedValueOnce({ summary_of_previous_context: "" })
      .mockResolvedValueOnce({
        summary_of_previous_context: "Summarized first request",
      });

    try {
      render(
        <SessionsList
          sessions={[makeSession("s-new", isoToday, "")]}
          loading={false}
          selectedSessionId={null}
          onSessionClick={vi.fn()}
        />,
      );

      expect(screen.getByRole("treeitem", { name: "New chat" })).toBeInTheDocument();
      await act(async () => {
        await Promise.resolve();
      });
      expect(api.summarizeSession).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        screen.getByRole("treeitem", { name: "Summarized first request" }),
      ).toBeInTheDocument();
      expect(api.summarizeSession).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

    const second = screen.getByRole("treeitem", { name: "Second" });
    expect(second).toHaveAttribute("aria-current", "page");
    const first = screen.getByRole("treeitem", { name: "First" });
    expect(first).not.toHaveAttribute("aria-current");
  });

  it("selects the optimistic New chat row when the URL has no real session yet", () => {
    const sessions = [
      makeSession("optimistic:new", isoToday, ""),
      makeSession("s1", isoYesterday, "Previous"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByRole("treeitem", { name: "New chat" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("treeitem", { name: "Previous" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps the explicit selected session over an optimistic New chat fallback", () => {
    const sessions = [
      makeSession("optimistic:new", isoToday, ""),
      makeSession("s1", isoYesterday, "Previous"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="s1"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByRole("treeitem", { name: "Previous" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("treeitem", { name: "New chat" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // Regression: after `replaceSessionId` swaps the optimistic id for the
  // server-assigned UUID, the row in this list is no longer optimistic
  // but `?session=` may not have propagated through `useSearchParams`
  // yet (the React Router navigate from `useNewSessionUrlSync` lands a
  // tick later). Without the most-recent fallback, the just-created
  // session visibly appeared at the top of the list with its
  // server-generated title but read as unselected for the gap. Falling
  // back to `titledRows[0]` keeps it highlighted.
  it("falls back to the newest row after optimistic→real swap before the URL settles", () => {
    const sessions = [
      // Just-swapped row: real UUID, started_at stamped at insert time
      // so it sorts to the top of TODAY.
      makeSession(
        "11111111-1111-4111-8111-111111111111",
        isoToday,
        "What Is A Cat",
      ),
      makeSession("s1", isoYesterday, "Greeting"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("treeitem", { name: "What Is A Cat" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("treeitem", { name: "Greeting" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // Regression: clicking another session used to remount the entire
  // ZUI Explorer subtree (the bucket-keyed `${label}:${id}` hack that
  // `SessionsList` carried before the controlled-`selectedIds`
  // refactor), which manifested as a flicker / dropped click in the
  // sidekick. With controlled selection the row DOM nodes are
  // referentially stable across selection changes.
  it("does not remount session rows when the selection changes", () => {
    const sessions = [
      makeSession("s1", isoToday, "First"),
      makeSession("s2", isoToday, "Second"),
    ];

    const { rerender } = render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="s1"
        onSessionClick={vi.fn()}
      />,
    );

    const firstBefore = screen.getByRole("treeitem", { name: "First" });
    const secondBefore = screen.getByRole("treeitem", { name: "Second" });

    rerender(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="s2"
        onSessionClick={vi.fn()}
      />,
    );

    const firstAfter = screen.getByRole("treeitem", { name: "First" });
    const secondAfter = screen.getByRole("treeitem", { name: "Second" });

    expect(firstAfter).toBe(firstBefore);
    expect(secondAfter).toBe(secondBefore);
    expect(secondAfter).toHaveAttribute("aria-current", "page");
    expect(firstAfter).not.toHaveAttribute("aria-current");
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

    fireEvent.click(screen.getByRole("treeitem", { name: "Pick me" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].session_id).toBe("s1");
  });

  // The prefetch hook is wired here (and not in the consumers) so the
  // pointer-enter ordering matches the click ordering — both consumers
  // (`ChatsTab`, projects-app `SessionList`) call into the shared
  // chat-history-store from the handler. The flicker the prefetch
  // exists to prevent only manifests when the cache is cold at click
  // time, so make sure the row actually fires the hook.
  it("calls onSessionHover on row pointer-enter", () => {
    const onHover = vi.fn();
    const sessions = [makeSession("s1", isoToday, "Hover me")];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        onSessionHover={onHover}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("treeitem", { name: "Hover me" }));
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0][0].session_id).toBe("s1");
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
