import { act, renderHook, waitFor } from "@testing-library/react";
import type { Session } from "../../shared/types";
import {
  useDefaultProjectSessionRedirect,
  useDefaultStandaloneSessionRedirect,
} from "./use-default-session-redirect";
import { useSessionsListStore } from "../../stores/sessions-list-store";
import { useProjectsListStore } from "../../stores/projects-list-store";

const listProjectSessions = vi.fn();
const listSessions = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listProjectSessions: (...args: unknown[]) => listProjectSessions(...args),
    listSessions: (...args: unknown[]) => listSessions(...args),
  },
}));

function makeSession(
  id: string,
  startedAt: string,
  agentInstanceId: string,
  projectId: string,
): Session {
  return {
    session_id: id,
    agent_instance_id: agentInstanceId,
    project_id: projectId,
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "",
    status: "completed",
    started_at: startedAt,
    ended_at: null,
  } as Session;
}

function resetStores() {
  useSessionsListStore.setState({
    sessionsBySurface: {},
    loadingBySurface: {},
    version: 0,
  });
  useProjectsListStore.setState({
    projects: [],
    agentsByProject: {},
  });
}

describe("useDefaultStandaloneSessionRedirect", () => {
  beforeEach(() => {
    listProjectSessions.mockReset();
    listSessions.mockReset();
    resetStores();
  });

  it("does not infinite-loop when projects state has bindings (regression)", () => {
    // The previous implementation handed `useShallow` fresh
    // `{ projectId, agentInstanceId }` objects on every selector call,
    // which broke shallow equality and triggered "Maximum update depth
    // exceeded". Mounting the hook below would have crashed.
    useProjectsListStore.setState({
      projects: [{ project_id: "p1", name: "P1" } as never],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-x" } as never],
      },
    });
    listSessions.mockResolvedValue([]);

    const setSearchParams = vi.fn();
    const { rerender } = renderHook(() =>
      useDefaultStandaloneSessionRedirect({
        agentId: "agent-x",
        sessionId: null,
        liveSessionId: null,
        setSearchParams,
      }),
    );

    rerender();
    rerender();
    rerender();
    expect(true).toBe(true);
  });

  it("redirects to the most recent session once it loads", async () => {
    useProjectsListStore.setState({
      projects: [{ project_id: "p1", name: "P1" } as never],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-x" } as never],
      },
    });
    listSessions.mockResolvedValue([
      makeSession("older", "2026-04-16T00:00:00Z", "i1", "p1"),
      makeSession("newest", "2026-04-16T05:00:00Z", "i1", "p1"),
    ]);

    const setSearchParams = vi.fn();
    renderHook(() =>
      useDefaultStandaloneSessionRedirect({
        agentId: "agent-x",
        sessionId: null,
        liveSessionId: null,
        setSearchParams,
      }),
    );

    await waitFor(() => {
      expect(setSearchParams).toHaveBeenCalledTimes(1);
    });

    const updater = setSearchParams.mock.calls[0][0] as (
      prev: URLSearchParams,
    ) => URLSearchParams;
    const next = updater(new URLSearchParams());
    expect(next.get("session")).toBe("newest");
    expect(next.get("project")).toBe("p1");
    expect(next.get("instance")).toBe("i1");
  });

  it("only fires once even if the most recent session changes after the redirect", async () => {
    useProjectsListStore.setState({
      projects: [{ project_id: "p1", name: "P1" } as never],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-x" } as never],
      },
    });
    listSessions.mockResolvedValueOnce([
      makeSession("first", "2026-04-16T00:00:00Z", "i1", "p1"),
    ]);

    const setSearchParams = vi.fn();
    renderHook(() =>
      useDefaultStandaloneSessionRedirect({
        agentId: "agent-x",
        sessionId: null,
        liveSessionId: null,
        setSearchParams,
      }),
    );

    await waitFor(() => {
      expect(setSearchParams).toHaveBeenCalledTimes(1);
    });

    listSessions.mockResolvedValueOnce([
      makeSession("second", "2026-04-16T08:00:00Z", "i1", "p1"),
    ]);

    await act(async () => {
      await useSessionsListStore.getState().loadAgentSessions("agent-x");
    });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
  });

  it("skips when disabled", () => {
    useProjectsListStore.setState({
      projects: [{ project_id: "p1", name: "P1" } as never],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-x" } as never],
      },
    });
    listSessions.mockResolvedValue([
      makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
    ]);

    const setSearchParams = vi.fn();
    renderHook(() =>
      useDefaultStandaloneSessionRedirect({
        agentId: "agent-x",
        sessionId: null,
        liveSessionId: null,
        setSearchParams,
        disabled: true,
      }),
    );

    expect(setSearchParams).not.toHaveBeenCalled();
    expect(listSessions).not.toHaveBeenCalled();
  });
});

describe("useDefaultProjectSessionRedirect", () => {
  beforeEach(() => {
    listProjectSessions.mockReset();
    resetStores();
  });

  it("redirects to the most recent session for the active agent instance", async () => {
    listProjectSessions.mockResolvedValue([
      makeSession("other-agent", "2026-04-16T08:00:00Z", "i-other", "p1"),
      makeSession("ours-newest", "2026-04-16T05:00:00Z", "i1", "p1"),
      makeSession("ours-older", "2026-04-16T00:00:00Z", "i1", "p1"),
    ]);

    const setSearchParams = vi.fn();
    renderHook(() =>
      useDefaultProjectSessionRedirect({
        projectId: "p1",
        agentInstanceId: "i1",
        sessionId: null,
        liveSessionId: null,
        setSearchParams,
      }),
    );

    await waitFor(() => {
      expect(setSearchParams).toHaveBeenCalledTimes(1);
    });
    const updater = setSearchParams.mock.calls[0][0] as (
      prev: URLSearchParams,
    ) => URLSearchParams;
    const next = updater(new URLSearchParams());
    expect(next.get("session")).toBe("ours-newest");
  });

  it("does not redirect when sessionId is already pinned", async () => {
    listProjectSessions.mockResolvedValue([
      makeSession("recent", "2026-04-16T05:00:00Z", "i1", "p1"),
    ]);

    const setSearchParams = vi.fn();
    renderHook(() =>
      useDefaultProjectSessionRedirect({
        projectId: "p1",
        agentInstanceId: "i1",
        sessionId: "already-set",
        liveSessionId: null,
        setSearchParams,
      }),
    );

    // Give effects a tick to run
    await act(async () => {
      await Promise.resolve();
    });
    expect(setSearchParams).not.toHaveBeenCalled();
  });
});
