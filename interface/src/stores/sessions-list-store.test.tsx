import { act, renderHook } from "@testing-library/react";
import type { Session } from "../shared/types";
import {
  agentSessionsSurfaceKey,
  PENDING_NEW_CHAT_ID,
  type PendingNewChat,
  projectSessionsSurfaceKey,
  useAgentBindingsKey,
  useMostRecentSession,
  usePendingNewChat,
  useSessionsForSurface,
  useSessionsListStore,
} from "./sessions-list-store";
import { useProjectsListStore } from "./projects-list-store";

const listProjectSessions = vi.fn();
const listSessions = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listProjectSessions: (...args: unknown[]) => listProjectSessions(...args),
    listSessions: (...args: unknown[]) => listSessions(...args),
  },
}));

function makeSession(id: string, startedAt: string, agentInstanceId: string, projectId: string): Session {
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
    pendingNewChatBySurface: {},
    version: 0,
  });
  useProjectsListStore.setState({
    projects: [],
    agentsByProject: {},
  });
}

function makePendingNewChat(
  projectId: string,
  agentInstanceId: string,
): PendingNewChat {
  return {
    session_id: PENDING_NEW_CHAT_ID,
    agent_instance_id: agentInstanceId,
    project_id: projectId,
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "",
    status: "active",
    started_at: "2026-04-16T05:00:00Z",
    ended_at: null,
    _projectId: projectId,
    _agentInstanceId: agentInstanceId,
    _projectName: "",
    _pending: true,
  };
}

describe("sessions-list-store", () => {
  beforeEach(() => {
    listProjectSessions.mockReset();
    listSessions.mockReset();
    resetStores();
  });

  describe("useAgentBindingsKey", () => {
    it("returns a stable string fingerprint of an agent's bindings", () => {
      useProjectsListStore.setState({
        projects: [
          { project_id: "p1", name: "P1" } as never,
          { project_id: "p2", name: "P2" } as never,
        ],
        agentsByProject: {
          p1: [{ agent_instance_id: "i1", agent_id: "agent-x" } as never],
          p2: [
            { agent_instance_id: "i2a", agent_id: "agent-x" } as never,
            { agent_instance_id: "i2b", agent_id: "agent-y" } as never,
          ],
        },
      });

      const { result, rerender } = renderHook(() =>
        useAgentBindingsKey("agent-x"),
      );

      const first = result.current;
      expect(first).toBe("p1:i1,p2:i2a");

      // The buggy selector this replaces returned a fresh object array
      // every render, defeating useShallow and triggering an infinite
      // loop. Stable string fingerprints can't drift on identity.
      rerender();
      rerender();
      expect(result.current).toBe(first);
    });

    it("returns an empty string when the agent has no bindings", () => {
      useProjectsListStore.setState({
        projects: [{ project_id: "p1", name: "P1" } as never],
        agentsByProject: {
          p1: [{ agent_instance_id: "i1", agent_id: "agent-other" } as never],
        },
      });

      const { result } = renderHook(() => useAgentBindingsKey("agent-x"));
      expect(result.current).toBe("");
    });
  });

  describe("useSessionsForSurface", () => {
    it("returns the same empty-array reference when the surface is missing", () => {
      const { result, rerender } = renderHook(() =>
        useSessionsForSurface("project:none"),
      );
      const first = result.current;
      expect(first).toEqual([]);
      rerender();
      expect(result.current).toBe(first);
    });

    it("returns store-owned arrays with stable identity across renders", async () => {
      listProjectSessions.mockResolvedValue([
        makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
      ]);

      const { result, rerender } = renderHook(() =>
        useSessionsForSurface(projectSessionsSurfaceKey("p1")),
      );

      await act(async () => {
        await useSessionsListStore
          .getState()
          .loadProjectSessions("p1", "Project One");
      });

      const first = result.current;
      expect(first).toHaveLength(1);
      rerender();
      expect(result.current).toBe(first);
    });
  });

  describe("loadAgentSessions", () => {
    it("derives bindings from the projects store and fans out per binding", async () => {
      useProjectsListStore.setState({
        projects: [
          { project_id: "p1", name: "P1" } as never,
          { project_id: "p2", name: "P2" } as never,
        ],
        agentsByProject: {
          p1: [{ agent_instance_id: "i1", agent_id: "agent-x" } as never],
          p2: [{ agent_instance_id: "i2", agent_id: "agent-x" } as never],
        },
      });

      listSessions.mockImplementation(
        (projectId: string, instanceId: string) =>
          Promise.resolve([
            makeSession(
              `${projectId}-${instanceId}`,
              "2026-04-16T00:00:00Z",
              instanceId,
              projectId,
            ),
          ]),
      );

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      expect(listSessions).toHaveBeenCalledTimes(2);
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const sessions =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(sessions).toHaveLength(2);
      expect(sessions?.map((s) => s._projectId).sort()).toEqual(["p1", "p2"]);
    });

    it("stores sessions sorted by started_at desc so [0] is the most recent", async () => {
      useProjectsListStore.setState({
        projects: [{ project_id: "p1", name: "P1" } as never],
        agentsByProject: {
          p1: [{ agent_instance_id: "i1", agent_id: "agent-x" } as never],
        },
      });
      listSessions.mockResolvedValue([
        makeSession("older", "2026-04-16T00:00:00Z", "i1", "p1"),
        makeSession("newer", "2026-04-16T05:00:00Z", "i1", "p1"),
      ]);

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const { result } = renderHook(() =>
        useMostRecentSession(agentSessionsSurfaceKey("agent-x")),
      );
      expect(result.current?.session_id).toBe("newer");
    });

    it("ignores out-of-order responses via per-surface request ids", async () => {
      useProjectsListStore.setState({
        projects: [{ project_id: "p1", name: "P1" } as never],
        agentsByProject: {
          p1: [{ agent_instance_id: "i1", agent_id: "agent-x" } as never],
        },
      });

      let resolveFirst!: (sessions: Session[]) => void;
      const firstFetch = new Promise<Session[]>((resolve) => {
        resolveFirst = resolve;
      });
      listSessions.mockReturnValueOnce(firstFetch);
      listSessions.mockResolvedValueOnce([
        makeSession("v2", "2026-04-16T02:00:00Z", "i1", "p1"),
      ]);

      const { loadAgentSessions } = useSessionsListStore.getState();
      const firstPromise = loadAgentSessions("agent-x");
      const secondPromise = loadAgentSessions("agent-x");

      // Resolve the first fetch *after* the second one is queued. The
      // store should drop the stale result.
      resolveFirst([
        makeSession("v1", "2026-04-16T01:00:00Z", "i1", "p1"),
      ]);
      await act(async () => {
        await Promise.all([firstPromise, secondPromise]);
      });

      const sessions =
        useSessionsListStore.getState().sessionsBySurface[
          agentSessionsSurfaceKey("agent-x")
        ];
      expect(sessions?.map((s) => s.session_id)).toEqual(["v2"]);
    });
  });

  describe("removeSession / restoreSession", () => {
    it("removeSession is a no-op when the surface or session is missing", () => {
      const { removeSession } = useSessionsListStore.getState();
      act(() => {
        removeSession("project:nope", "s-nope");
      });
      expect(useSessionsListStore.getState().sessionsBySurface).toEqual({});
    });

    it("restoreSession inserts and re-sorts; removeSession filters in place", () => {
      const surfaceKey = projectSessionsSurfaceKey("p1");
      const older = {
        ...makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      const newer = {
        ...makeSession("s2", "2026-04-16T05:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      const { restoreSession, removeSession } = useSessionsListStore.getState();

      act(() => {
        restoreSession(surfaceKey, older);
        restoreSession(surfaceKey, newer);
      });
      expect(
        useSessionsListStore
          .getState()
          .sessionsBySurface[surfaceKey]?.map((s) => s.session_id),
      ).toEqual(["s2", "s1"]);

      act(() => {
        removeSession(surfaceKey, "s1");
      });
      expect(
        useSessionsListStore
          .getState()
          .sessionsBySurface[surfaceKey]?.map((s) => s.session_id),
      ).toEqual(["s2"]);
    });
  });

  describe("pendingNewChat (optimistic '+' placeholder)", () => {
    // The chat-input "+" button surfaces a synthetic "New chat" row in
    // the sidekick before the server has assigned a session id (and
    // before any `loadAgentSessions` returns the real row). The store
    // tracks it on a sibling axis from `sessionsBySurface` so the
    // request-id race protections in the loaders don't have to thread
    // the placeholder through their merge logic. The tests below pin
    // the contract: set, clear, prepend-on-read, survives unrelated
    // session writes.
    it("setPendingNewChat then useSessionsForSurface returns the placeholder prepended", () => {
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const pending = makePendingNewChat("p1", "i1");

      act(() => {
        useSessionsListStore.getState().setPendingNewChat(surfaceKey, pending);
      });

      const { result } = renderHook(() => useSessionsForSurface(surfaceKey));
      expect(result.current).toHaveLength(1);
      expect(result.current[0].session_id).toBe(PENDING_NEW_CHAT_ID);
      expect((result.current[0] as PendingNewChat)._pending).toBe(true);
    });

    it("clearPendingNewChat removes the placeholder from useSessionsForSurface", () => {
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const pending = makePendingNewChat("p1", "i1");

      const { result } = renderHook(() => useSessionsForSurface(surfaceKey));

      act(() => {
        useSessionsListStore.getState().setPendingNewChat(surfaceKey, pending);
      });
      expect(result.current).toHaveLength(1);

      act(() => {
        useSessionsListStore.getState().clearPendingNewChat(surfaceKey);
      });
      expect(result.current).toHaveLength(0);
    });

    it("usePendingNewChat tracks the placeholder per surface", () => {
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const pending = makePendingNewChat("p1", "i1");

      const { result } = renderHook(() => usePendingNewChat(surfaceKey));
      expect(result.current).toBeNull();

      act(() => {
        useSessionsListStore.getState().setPendingNewChat(surfaceKey, pending);
      });
      expect(result.current?.session_id).toBe(PENDING_NEW_CHAT_ID);

      act(() => {
        useSessionsListStore.getState().clearPendingNewChat(surfaceKey);
      });
      expect(result.current).toBeNull();
    });

    it("survives a real session being added to the surface — only explicit clearPendingNewChat removes it", async () => {
      // Regression coverage for the placeholder lifecycle: the only
      // signal that's allowed to drop the placeholder is the
      // `SessionReady` -> `clearPendingNewChat` path. A `loadAgentSessions`
      // refresh that brings in the real, server-persisted row must NOT
      // automatically drop the placeholder, because the URL flip and
      // the placeholder clear are the two sources of truth — clearing
      // here too early would leave the user with a flicker between
      // "highlighted New chat" and "no row highlighted, real row arrives".
      useProjectsListStore.setState({
        projects: [{ project_id: "p1", name: "P1" } as never],
        agentsByProject: {
          p1: [
            { agent_instance_id: "i1", agent_id: "agent-x" } as never,
          ],
        },
      });
      listSessions.mockResolvedValue([
        makeSession("s-real", "2026-04-16T05:00:00Z", "i1", "p1"),
      ]);

      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const pending = makePendingNewChat("p1", "i1");

      act(() => {
        useSessionsListStore.getState().setPendingNewChat(surfaceKey, pending);
      });

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const list =
        useSessionsListStore
          .getState()
          .pendingNewChatBySurface[surfaceKey];
      expect(list).toBeDefined();
      expect(list?.session_id).toBe(PENDING_NEW_CHAT_ID);

      const { result } = renderHook(() => useSessionsForSurface(surfaceKey));
      const ids = result.current.map((s) => s.session_id);
      expect(ids).toEqual([PENDING_NEW_CHAT_ID, "s-real"]);
    });

    it("clearPendingNewChat is a no-op when no placeholder is set", () => {
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      act(() => {
        useSessionsListStore.getState().clearPendingNewChat(surfaceKey);
      });
      expect(
        useSessionsListStore.getState().pendingNewChatBySurface,
      ).toEqual({});
    });
  });
});
