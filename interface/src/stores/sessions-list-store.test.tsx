import { act, renderHook } from "@testing-library/react";
import type { Session } from "../shared/types";
import type { AnnotatedSession } from "../components/SessionsList";
import {
  agentSessionsSurfaceKey,
  buildOptimisticSession,
  isOptimisticSessionId,
  OPTIMISTIC_SESSION_ID_PREFIX,
  projectSessionsSurfaceKey,
  useAgentBindingsKey,
  useAgentBindingsLoadStatus,
  useMostRecentSession,
  useSessionsForSurface,
  useSessionsListStore,
} from "./sessions-list-store";
import { useProjectsListStore } from "./projects-list-store";

const listProjectSessions = vi.fn();
const listSessions = vi.fn();
const listProjectBindings = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listProjectSessions: (...args: unknown[]) => listProjectSessions(...args),
    listSessions: (...args: unknown[]) => listSessions(...args),
    agents: {
      listProjectBindings: (...args: unknown[]) =>
        listProjectBindings(...args),
    },
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
    bindingsByAgent: {},
    bindingsLoadStatusByAgent: {},
    version: 0,
  });
  useProjectsListStore.setState({
    projects: [],
    agentsByProject: {},
  });
}

describe("sessions-list-store", () => {
  beforeEach(() => {
    listProjectSessions.mockReset();
    listSessions.mockReset();
    listProjectBindings.mockReset();
    resetStores();
  });

  describe("useAgentBindingsKey", () => {
    it("returns a stable string fingerprint of an agent's bindings once loaded", () => {
      useSessionsListStore.setState({
        bindingsByAgent: {
          "agent-x": [
            { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
            { project_agent_id: "i2a", project_id: "p2", project_name: "P2" },
          ],
        },
        bindingsLoadStatusByAgent: { "agent-x": "loaded" },
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

    it("returns an empty string when the agent has no bindings (server fetched empty)", () => {
      useSessionsListStore.setState({
        bindingsByAgent: { "agent-x": [] },
        bindingsLoadStatusByAgent: { "agent-x": "loaded" },
      });

      const { result } = renderHook(() => useAgentBindingsKey("agent-x"));
      expect(result.current).toBe("");
    });

    it("returns an empty string before bindings have been fetched (idle)", () => {
      const { result } = renderHook(() => useAgentBindingsKey("agent-x"));
      expect(result.current).toBe("");
    });
  });

  describe("useAgentBindingsLoadStatus", () => {
    it("starts at idle and reflects the agent-keyed status", () => {
      const { result, rerender } = renderHook(() =>
        useAgentBindingsLoadStatus("agent-x"),
      );
      expect(result.current).toBe("idle");

      act(() => {
        useSessionsListStore.setState({
          bindingsLoadStatusByAgent: { "agent-x": "loading" },
        });
      });
      rerender();
      expect(result.current).toBe("loading");

      act(() => {
        useSessionsListStore.setState({
          bindingsLoadStatusByAgent: { "agent-x": "loaded" },
        });
      });
      rerender();
      expect(result.current).toBe("loaded");
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
    it("fetches authoritative bindings from the server and fans out per binding", async () => {
      // Crucially: nothing in `useProjectsListStore`. The fix is that
      // `loadAgentSessions` must NOT depend on the active-org-scoped
      // client snapshot — it must call the server-authoritative
      // `listProjectBindings` endpoint.
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
        { project_agent_id: "i2", project_id: "p2", project_name: "P2" },
      ]);
      listSessions.mockImplementation(
        (projectId: string, projectAgentId: string) =>
          Promise.resolve([
            makeSession(
              `${projectId}-${projectAgentId}`,
              "2026-04-16T00:00:00Z",
              projectAgentId,
              projectId,
            ),
          ]),
      );

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      expect(listProjectBindings).toHaveBeenCalledTimes(1);
      expect(listProjectBindings).toHaveBeenCalledWith("agent-x");
      expect(listSessions).toHaveBeenCalledTimes(2);
      expect(listSessions).toHaveBeenCalledWith("p1", "i1");
      expect(listSessions).toHaveBeenCalledWith("p2", "i2");

      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const sessions =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(sessions).toHaveLength(2);
      expect(sessions?.map((s) => s._projectId).sort()).toEqual(["p1", "p2"]);
      expect(sessions?.map((s) => s._projectName).sort()).toEqual(["P1", "P2"]);

      const status =
        useSessionsListStore.getState().bindingsLoadStatusByAgent["agent-x"];
      expect(status).toBe("loaded");
    });

    it("regression: surfaces sessions for an agent whose only binding is invisible to useProjectsListStore (Glenn / Machina)", async () => {
      // Reproduces the bug: an older remote agent auto-bound to a Home
      // project that lives outside the active-org sidebar. The active
      // org's projects list has no entry for the agent at all.
      useProjectsListStore.setState({
        projects: [{ project_id: "visible-project", name: "Visible" } as never],
        agentsByProject: {
          "visible-project": [
            { agent_instance_id: "iv", agent_id: "some-other-agent" } as never,
          ],
        },
      });
      listProjectBindings.mockResolvedValue([
        {
          project_agent_id: "pa-home",
          project_id: "p-home-other-org",
          project_name: "Home",
        },
      ]);
      listSessions.mockResolvedValue([
        makeSession("home-session", "2026-04-16T00:00:00Z", "pa-home", "p-home-other-org"),
      ]);

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("glenn");
      });

      const sessions =
        useSessionsListStore.getState().sessionsBySurface[
          agentSessionsSurfaceKey("glenn")
        ];
      expect(sessions).toHaveLength(1);
      expect(sessions?.[0].session_id).toBe("home-session");
      expect(sessions?.[0]._projectId).toBe("p-home-other-org");
      expect(sessions?.[0]._projectName).toBe("Home");
    });

    it("stores sessions sorted by started_at desc so [0] is the most recent", async () => {
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);
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

    it("marks the bindings status as 'error' when listProjectBindings fails and skips the session fan-out", async () => {
      listProjectBindings.mockRejectedValue(new Error("boom"));
      const consoleErr = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      expect(listSessions).not.toHaveBeenCalled();
      const status =
        useSessionsListStore.getState().bindingsLoadStatusByAgent["agent-x"];
      expect(status).toBe("error");
      consoleErr.mockRestore();
    });

    it("ignores out-of-order responses via per-surface request ids", async () => {
      // The loader has two checkpoints: after listProjectBindings, and
      // after the per-binding listSessions fan-out. This test exercises
      // the second one — call 1 holds at listSessions, call 2 finishes,
      // then call 1's stale listSessions result is dropped.
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);

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

      // Drain microtasks so call 1 clears its listProjectBindings await
      // and reaches the listSessions await BEFORE call 2 starts and
      // bumps the request id. Without this, call 1's bindings-checkpoint
      // request-id check would short-circuit it before listSessions is
      // ever invoked, defeating the second-checkpoint test.
      await Promise.resolve();
      await Promise.resolve();

      const secondPromise = loadAgentSessions("agent-x");

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

  describe("addOptimisticSession / replaceSessionId", () => {
    function annotate(session: Session): AnnotatedSession {
      return {
        ...session,
        _projectId: session.project_id,
        _projectName: "P1",
        _agentInstanceId: session.agent_instance_id,
      };
    }

    it("inserts the optimistic row at the top of the surface for the just-pressed +", () => {
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const existing = annotate(
        makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
      );
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [existing] },
      });
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });

      act(() => {
        useSessionsListStore
          .getState()
          .addOptimisticSession(surfaceKey, optimistic);
      });

      const ids = useSessionsListStore
        .getState()
        .sessionsBySurface[surfaceKey]?.map((s) => s.session_id);
      expect(ids?.[0]).toBe(optimistic.session_id);
      expect(ids).toContain("s1");
      expect(isOptimisticSessionId(optimistic.session_id)).toBe(true);
    });

    it("dedupes when the same optimistic id is added twice", () => {
      const surfaceKey = projectSessionsSurfaceKey("p1");
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });

      act(() => {
        const store = useSessionsListStore.getState();
        store.addOptimisticSession(surfaceKey, optimistic);
        store.addOptimisticSession(surfaceKey, optimistic);
      });

      expect(
        useSessionsListStore.getState().sessionsBySurface[surfaceKey],
      ).toHaveLength(1);
    });

    it("replaceSessionId rewrites the row in place when SessionReady arrives", () => {
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const existing = annotate(
        makeSession("s1", "2026-04-16T01:00:00Z", "i1", "p1"),
      );
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic, existing] },
      });

      act(() => {
        useSessionsListStore
          .getState()
          .replaceSessionId(surfaceKey, optimistic.session_id, "real-session");
      });

      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(rows?.map((s) => s.session_id)).toEqual([
        "real-session",
        "s1",
      ]);
    });

    it("replaceSessionId drops the optimistic row when the real id already exists", () => {
      // Race: a parallel `loadAgentSessions` brings the real session
      // back before `SessionReady` lands. We must not produce two rows
      // for the same session.
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const real = annotate(
        makeSession("real-session", "2026-04-16T01:00:00Z", "i1", "p1"),
      );
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic, real] },
      });

      act(() => {
        useSessionsListStore
          .getState()
          .replaceSessionId(surfaceKey, optimistic.session_id, "real-session");
      });

      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(rows?.map((s) => s.session_id)).toEqual(["real-session"]);
    });

    it("preserves optimistic rows across an in-flight loadAgentSessions refetch", async () => {
      // The bumpVersion that fires alongside SessionReady triggers a
      // fresh fan-out; the just-created session may still be filtered
      // out by the server's `filter_nonempty_sessions`. The store
      // carries the optimistic row through so the sidekick doesn't
      // flicker empty.
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);
      listSessions.mockResolvedValue([
        makeSession("older", "2026-04-15T00:00:00Z", "i1", "p1"),
      ]);
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic] },
      });

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const ids = useSessionsListStore
        .getState()
        .sessionsBySurface[surfaceKey]?.map((s) => s.session_id);
      expect(ids).toContain(optimistic.session_id);
      expect(ids).toContain("older");
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

});
