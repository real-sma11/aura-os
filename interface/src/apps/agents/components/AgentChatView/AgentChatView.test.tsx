import { act, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { AgentChatView } from "./AgentChatView";

type FakeProject = { project_id: string; name: string };
type FakeAgentInstance = { agent_instance_id: string; agent_id: string };
type FakeAnnotatedSession = {
  session_id: string;
  _projectId: string;
  _agentInstanceId: string;
};
type FakeHistoryEntry = { status: "loading" | "ready" | "error" };

const mocks = vi.hoisted(() => ({
  params: { agentId: "agent-1", projectId: undefined, agentInstanceId: undefined } as {
    agentId?: string;
    projectId?: string;
    agentInstanceId?: string;
  },
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  isMobileLayout: false,
  latestChatPanelProps: undefined as Record<string, unknown> | undefined,
  latestHistorySyncOptions: undefined as Record<string, unknown> | undefined,
  setSelectedAgent: vi.fn(),
  sendMessage: vi.fn(),
  stopStreaming: vi.fn(),
  resetEvents: vi.fn(),
  markNextSendAsNewSession: vi.fn(),
  getIsStreaming: vi.fn(() => false),
  // Stores controlled per-test so we can exercise the defer-render gate
  // for "redirect is about to fire" without spinning up the real stores.
  projectsState: {
    projects: [] as FakeProject[],
    agentsByProject: {} as Record<string, FakeAgentInstance[]>,
  },
  sessionsState: {
    sessionsBySurface: {} as Record<string, FakeAnnotatedSession[]>,
  },
  // Per-agent bindings load status. Tests that exercise the
  // "loadAgentSessions in flight" defer-render branch override an
  // entry to `"loading"` so the shell falls into the pending state.
  // Default falls back to `"loaded"` inside the mocked hook so most
  // tests behave like before this fix.
  bindingsLoadStatusByAgent: {} as Record<
    string,
    "idle" | "loading" | "loaded" | "error"
  >,
  historyEntries: {} as Record<string, FakeHistoryEntry>,
  fetchHistory: vi.fn(),
  clearHistory: vi.fn(),
  bumpVersion: vi.fn(),
  addOptimisticSession: vi.fn(),
  replaceSessionId: vi.fn(),
  defaultStandaloneRedirect: vi.fn(),
  streamState: {
    entries: {} as Record<string, { events: Array<{ id: string }> }>,
  },
  // Captured per `useChatStream` invocation so tests can simulate the
  // server-side `SessionReady` SSE event by calling the callback the
  // panel registered.
  capturedOnSessionReady: undefined as ((sessionId: string) => void) | undefined,
}));

vi.mock("react-router-dom", () => ({
  useParams: () => mocks.params,
  useLocation: () => ({ state: null }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock("../../../../api/client", () => ({
  api: {
    agents: {
      listEvents: vi.fn().mockResolvedValue([]),
      getContextUsage: vi.fn().mockResolvedValue({ context_utilization: 0 }),
      resetSession: vi.fn().mockResolvedValue(undefined),
    },
    getEvents: vi.fn().mockResolvedValue([]),
    listSessionEvents: vi.fn().mockResolvedValue([]),
    resetInstanceSession: vi.fn().mockResolvedValue(undefined),
    updateAgentInstance: vi.fn().mockResolvedValue({}),
    stopLoop: vi.fn().mockResolvedValue(undefined),
  },
  STANDALONE_AGENT_HISTORY_LIMIT: 50,
}));

vi.mock("../../../../hooks/use-agent-chat-stream", () => ({
  useAgentChatStream: () => ({
    streamKey: "agent-stream",
    sendMessage: mocks.sendMessage,
    stopStreaming: mocks.stopStreaming,
    resetEvents: mocks.resetEvents,
    markNextSendAsNewSession: mocks.markNextSendAsNewSession,
  }),
}));

vi.mock("../../../../hooks/use-chat-stream", () => ({
  useChatStream: (options: { onSessionReady?: (id: string) => void }) => {
    mocks.capturedOnSessionReady = options.onSessionReady;
    return {
      streamKey: "project-stream",
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      resetEvents: mocks.resetEvents,
      markNextSendAsNewSession: mocks.markNextSendAsNewSession,
    };
  },
}));

vi.mock("../../../../hooks/use-chat-history-sync", () => ({
  useChatHistorySync: (options: Record<string, unknown>) => {
    mocks.latestHistorySyncOptions = options;
    const historyKey = options.historyKey;
    const entry = typeof historyKey === "string" ? mocks.historyEntries[historyKey] : undefined;
    const historyResolved = entry ? entry.status === "ready" || entry.status === "error" : true;
    return {
      historyMessages: [],
      historyResolved,
      isLoading: entry ? entry.status === "loading" : false,
      historyError: null,
      wrapSend: (fn: (...args: unknown[]) => unknown) => fn,
    };
  },
}));

vi.mock("../../../../hooks/stream/store", () => ({
  getIsStreaming: (key: string) => mocks.getIsStreaming(key),
  useStreamStore: {
    setState: (
      updater: (
        state: typeof mocks.streamState,
      ) => Partial<typeof mocks.streamState> | typeof mocks.streamState,
    ) => {
      const patch = updater(mocks.streamState);
      Object.assign(mocks.streamState, patch);
    },
    getState: () => mocks.streamState,
  },
}));

vi.mock("../../../../shared/hooks/use-delayed-loading", () => ({
  useDelayedLoading: (loading: boolean) => loading,
}));

vi.mock("../../../../hooks/use-agent-chat-meta", () => ({
  useAgentChatMeta: () => ({
    agentName: "Test Agent",
    machineType: "remote",
    templateAgentId: "template-1",
    adapterType: "aura_harness",
    defaultModel: "aura-gpt-5-4",
  }),
  useStandaloneAgentMeta: () => ({
    agentName: "Test Agent",
    machineType: "remote",
    templateAgentId: "template-1",
    adapterType: "aura_harness",
    defaultModel: "aura-gpt-5-4",
  }),
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: mocks.isMobileLayout }),
}));

vi.mock("../../../../hooks/use-agent-busy", () => ({
  useAgentBusy: () => ({ isBusy: false, reason: null }),
}));

vi.mock("../../../../hooks/use-hydrate-context-utilization", () => ({
  useHydrateContextUtilization: vi.fn(),
}));

vi.mock("../../../../stores/context-usage-store", () => ({
  useContextUsage: () => undefined,
  useContextUsageStore: {
    getState: () => ({
      clearContextUtilization: vi.fn(),
      markResetPending: vi.fn(),
    }),
  },
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { projects: FakeProject[]; agentsByProject: Record<string, FakeAgentInstance[]>; setAgentsByProject: () => void }) => unknown) =>
    selector({
      projects: mocks.projectsState.projects,
      agentsByProject: mocks.projectsState.agentsByProject,
      setAgentsByProject: vi.fn(),
    }),
}));

vi.mock("../../../../stores/sessions-list-store", () => {
  type FakeSessionsListState = {
    sessionsBySurface: Record<string, FakeAnnotatedSession[]>;
    bumpVersion: () => void;
    addOptimisticSession: (
      surfaceKey: string,
      session: FakeAnnotatedSession,
    ) => void;
    replaceSessionId: (
      surfaceKey: string,
      oldSessionId: string,
      newSessionId: string,
    ) => void;
  };
  const addOptimisticSession = (
    surfaceKey: string,
    session: FakeAnnotatedSession,
  ) => {
    mocks.addOptimisticSession(surfaceKey, session);
    const current = mocks.sessionsState.sessionsBySurface[surfaceKey] ?? [];
    if (current.some((s) => s.session_id === session.session_id)) return;
    mocks.sessionsState.sessionsBySurface[surfaceKey] = [session, ...current];
  };
  const replaceSessionId = (
    surfaceKey: string,
    oldSessionId: string,
    newSessionId: string,
  ) => {
    mocks.replaceSessionId(surfaceKey, oldSessionId, newSessionId);
    const current = mocks.sessionsState.sessionsBySurface[surfaceKey];
    if (!current) return;
    const idx = current.findIndex((s) => s.session_id === oldSessionId);
    if (idx === -1) return;
    if (current.some((s) => s.session_id === newSessionId)) {
      mocks.sessionsState.sessionsBySurface[surfaceKey] = current.filter(
        (s) => s.session_id !== oldSessionId,
      );
      return;
    }
    const next = current.slice();
    next[idx] = { ...current[idx], session_id: newSessionId };
    mocks.sessionsState.sessionsBySurface[surfaceKey] = next;
  };
  const sessionsHook: ((selector: (state: FakeSessionsListState) => unknown) => unknown) & {
    getState: () => FakeSessionsListState;
  } = Object.assign(
    (selector: (state: FakeSessionsListState) => unknown) =>
      selector({
        sessionsBySurface: mocks.sessionsState.sessionsBySurface,
        bumpVersion: mocks.bumpVersion,
        addOptimisticSession,
        replaceSessionId,
      }),
    {
      getState: () => ({
        sessionsBySurface: mocks.sessionsState.sessionsBySurface,
        bumpVersion: mocks.bumpVersion,
        addOptimisticSession,
        replaceSessionId,
      }),
    },
  );
  return {
    agentSessionsSurfaceKey: (agentId: string) => `agent:${agentId}`,
    projectSessionsSurfaceKey: (projectId: string) => `project:${projectId}`,
    OPTIMISTIC_SESSION_ID_PREFIX: "optimistic:",
    buildOptimisticSession: (args: {
      optimisticId: string;
      projectId: string;
      projectName: string;
      agentInstanceId: string;
    }): FakeAnnotatedSession => ({
      session_id: args.optimisticId,
      _projectId: args.projectId,
      _agentInstanceId: args.agentInstanceId,
    }),
    useAgentBindingsKey: (agentId: string | undefined) => {
      if (!agentId) return "";
      const parts: string[] = [];
      for (const project of mocks.projectsState.projects) {
        const instances = mocks.projectsState.agentsByProject[project.project_id];
        if (!instances) continue;
        for (const instance of instances) {
          if (instance.agent_id === agentId) {
            parts.push(`${project.project_id}:${instance.agent_instance_id}`);
          }
        }
      }
      parts.sort();
      return parts.join(",");
    },
    // The real hook reads from the sessions-list-store's
    // `bindingsLoadStatusByAgent`. Unit tests for the shell-target
    // picker don't exercise the in-flight "pending" state, so we mirror
    // the legacy behavior: anything with bindings looks "loaded";
    // anything without is "loaded" too (= no pending flicker).
    useAgentBindingsLoadStatus: (agentId: string | undefined) => {
      if (!agentId) return "idle";
      return mocks.bindingsLoadStatusByAgent?.[agentId] ?? "loaded";
    },
    useMostRecentSession: (surfaceKey: string | undefined) => {
      if (!surfaceKey) return null;
      const list = mocks.sessionsState.sessionsBySurface[surfaceKey];
      return list && list.length > 0 ? list[0] : null;
    },
    useSessionsListStore: sessionsHook,
  };
});

vi.mock("../../../../stores/chat-history-store", () => ({
  agentHistoryKey: (agentId: string) => `agent:${agentId}`,
  projectChatHistoryKey: (projectId: string, agentInstanceId: string) =>
    `project:${projectId}:${agentInstanceId}`,
  sessionHistoryKey: (
    projectId: string,
    agentInstanceId: string,
    sessionId: string,
  ) => `session:${projectId}:${agentInstanceId}:${sessionId}`,
  useChatHistory: () => ({ events: [], status: "ready", error: null }),
  useChatHistoryStore: Object.assign(
    (selector: (state: { entries: Record<string, FakeHistoryEntry> }) => unknown) =>
      selector({ entries: mocks.historyEntries }),
    {
      getState: () => ({
        entries: mocks.historyEntries,
        fetchHistory: mocks.fetchHistory,
        clearHistory: mocks.clearHistory,
        invalidateHistory: vi.fn(),
        prefetchHistory: vi.fn(),
        hydrateFromCache: vi.fn(),
      }),
    },
  ),
}));

vi.mock("../../../../components/SessionsList/use-default-session-redirect", () => ({
  useDefaultStandaloneSessionRedirect: (...args: unknown[]) => mocks.defaultStandaloneRedirect(...args),
  useDefaultProjectSessionRedirect: vi.fn(),
}));

vi.mock("../../stores", () => ({
  LAST_AGENT_ID_KEY: "last-agent-id",
  useSelectedAgent: () => ({ setSelectedAgent: mocks.setSelectedAgent }),
  useAgentStore: (selector: (s: { setSelectedAgent: typeof mocks.setSelectedAgent }) => unknown) =>
    selector({ setSelectedAgent: mocks.setSelectedAgent }),
}));

vi.mock("../../../../stores/chat-handoff-store", () => ({
  useChatHandoffStore: () => vi.fn(),
}));

vi.mock("../../../../utils/chat-handoff", () => ({
  isCreateAgentChatHandoff: () => false,
  projectAgentHandoffTarget: vi.fn(),
  standaloneAgentHandoffTarget: vi.fn(),
}));

vi.mock("../../../../utils/storage", () => ({
  setLastAgent: vi.fn(),
  setLastProject: vi.fn(),
}));

vi.mock("../../../../lib/derive-project-agent-title", () => ({
  deriveProjectAgentTitle: () => "New Agent",
}));

vi.mock("../../../../queries/project-queries", () => ({
  mergeAgentIntoProjectAgents: vi.fn(),
  projectQueryKeys: {
    agentInstance: vi.fn(),
  },
}));

vi.mock("../../../../shared/lib/query-client", () => ({
  queryClient: {
    setQueryData: vi.fn(),
  },
}));

vi.mock("../../../chat/components/ChatPanel", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    mocks.latestChatPanelProps = props;
    return <div data-testid="chat-panel" />;
  },
}));

vi.mock("../../../../mobile/chat/MobileChatPanel", () => ({
  MobileChatPanel: () => <div data-testid="mobile-chat-panel" />,
}));

vi.mock("../../../../mobile/chat/MobileProjectAgentSwitcherSheet", () => ({
  MobileProjectAgentSwitcherSheet: () => null,
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./AgentChatView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("AgentChatView", () => {
  beforeEach(() => {
    mocks.params = { agentId: "agent-1", projectId: undefined, agentInstanceId: undefined };
    mocks.searchParams = new URLSearchParams();
    mocks.setSearchParams.mockReset();
    mocks.isMobileLayout = false;
    mocks.latestChatPanelProps = undefined;
    mocks.latestHistorySyncOptions = undefined;
    mocks.projectsState = { projects: [], agentsByProject: {} };
    mocks.sessionsState = { sessionsBySurface: {} };
    mocks.historyEntries = {};
    mocks.fetchHistory.mockReset();
    mocks.clearHistory.mockReset();
    mocks.bumpVersion.mockReset();
    mocks.addOptimisticSession.mockReset();
    mocks.replaceSessionId.mockReset();
    mocks.defaultStandaloneRedirect.mockReset();
    mocks.resetEvents.mockReset();
    mocks.getIsStreaming.mockReset();
    mocks.getIsStreaming.mockImplementation(() => false);
    mocks.streamState = { entries: {} };
    mocks.capturedOnSessionReady = undefined;
  });

  it("uses ChatPanel's desktop input autofocus for standalone agents", () => {
    render(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        agentId: "agent-1",
        scrollResetKey: "agent-1",
      }),
    );
    expect(mocks.latestChatPanelProps).not.toHaveProperty("focusInputOnThreadReady");
  });

  it("watches standalone agent ids for cross-agent chat updates", () => {
    render(<AgentChatView />);

    expect(mocks.latestHistorySyncOptions).toEqual(
      expect.objectContaining({
        historyKey: "agent:agent-1",
        streamKey: "agent-stream",
        hydrateToStream: false,
        watchAgentId: "agent-1",
      }),
    );
  });

  it("renders the project panel while a default-session redirect is pending (cached sessions)", () => {
    // Agent has bindings AND its sessions surface already holds a row, so the
    // redirect hook is going to write `?session=` into the URL on the very
    // next tick. Mounting `StandaloneAgentChatPanel` here would fire its
    // per-agent history fetch and produce a flicker when the URL settles
    // and `ProjectAgentChatPanel` swaps in. The concrete project target is
    // already known, so keep the project panel mounted while the URL catches up.
    mocks.projectsState = {
      projects: [{ project_id: "p1", name: "P1" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }],
      },
    };
    mocks.sessionsState = {
      sessionsBySurface: {
        "agent:agent-1": [{ session_id: "s1", _projectId: "p1", _agentInstanceId: "i1" }],
      },
    };

    render(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        agentId: "i1",
        historyResolved: true,
        scrollResetKey: "i1:s1",
        streamKey: "project-stream",
      }),
    );
  });

  it("eagerly prefetches session events for the imminent redirect target", () => {
    // While the redirect is still pending, the resolver should warm
    // `chat-history-store` so that when `ProjectAgentChatPanel`
    // eventually mounts, its per-session history fetch is already in
    // (or past) flight and the cold-load overlay never trips.
    mocks.projectsState = {
      projects: [{ project_id: "p1", name: "P1" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }],
      },
    };
    mocks.sessionsState = {
      sessionsBySurface: {
        "agent:agent-1": [{ session_id: "s1", _projectId: "p1", _agentInstanceId: "i1" }],
      },
    };

    render(<AgentChatView />);

    expect(mocks.fetchHistory).toHaveBeenCalledTimes(1);
    expect(mocks.fetchHistory).toHaveBeenCalledWith(
      "session:p1:i1:s1",
      expect.any(Function),
    );
  });

  it("renders the lane placeholder while a default-session redirect is pending (sessions not yet loaded)", () => {
    // Bindings exist but the sessions surface hasn't been loaded yet — the
    // redirect *may* fire once `loadAgentSessions` resolves. Defer until we
    // know one way or the other.
    mocks.projectsState = {
      projects: [{ project_id: "p1", name: "P1" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }],
      },
    };
    mocks.sessionsState = { sessionsBySurface: {} };

    render(<AgentChatView />);

    expect(screen.queryByTestId("chat-panel")).toBeNull();
    expect(mocks.latestChatPanelProps).toBeUndefined();
  });

  it("renders the standalone panel when the agent has no bindings (no redirect possible)", () => {
    mocks.projectsState = { projects: [], agentsByProject: {} };
    mocks.sessionsState = { sessionsBySurface: {} };

    render(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("renders the standalone panel when the agent has bindings but the sessions surface loaded empty", () => {
    // No sessions ever existed for this agent — the redirect hook will not
    // fire, so we should mount the standalone panel immediately and let the
    // user start a fresh chat.
    mocks.projectsState = {
      projects: [{ project_id: "p1", name: "P1" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }],
      },
    };
    mocks.sessionsState = {
      sessionsBySurface: {
        "agent:agent-1": [],
      },
    };

    render(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("renders the project panel while session events are still loading after the URL has session params", () => {
    // URL carries the redirected session params, but `chat-history-store`
    // hasn't reported `ready` for them yet. With the transcript now scoped
    // per session, the project panel can stay mounted and let ChatPanel's
    // cold-load overlay handle the in-panel reveal instead of swapping to
    // an outer placeholder.
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s1",
    });
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "loading" },
    };

    render(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        agentId: "i1",
        historyResolved: false,
        isLoading: true,
        scrollResetKey: "i1:s1",
        streamKey: "project-stream",
        transcriptKey: "session:p1:i1:s1",
      }),
    );
  });

  it("keeps the project panel mounted across session events loading to ready", () => {
    // Once the per-session history is `ready` in the cache, the same chat
    // panel instance receives `historyResolved=true` without an outer
    // placeholder/remount cycle.
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s1",
    });
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "loading" },
    };

    const { rerender } = render(<AgentChatView />);

    const panel = screen.getByTestId("chat-panel");
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        historyResolved: false,
        isLoading: true,
      }),
    );

    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
    };
    rerender(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBe(panel);
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        historyResolved: true,
        isLoading: false,
      }),
    );
  });

  it("keeps the project panel mounted and lets it reset the stream on a cross-session click in the agents-app shell", () => {
    // Bug being guarded: the project chat panel for session s1 unmounts
    // used to unmount when `useAgentsShellTarget` flipped to `placeholder`
    // while the new session's events fetched, then a brand-new project
    // panel mounted for the new session. The panel's local
    // `prevSessionIdRef` clear no longer survived the unmount/remount
    // cycle, so without a resolver-level reset the fresh mount inherited the previous
    // session's events from the shared `${projectId}:${agentInstanceId}`
    // stream slot and `useChatHistorySync`'s
    // `streamCount >= historyMessages.length` hydrate guard refuses to
    // overwrite them — manifesting as "first session click does not
    // load." The resolver no longer unmounts the panel; the panel-owned
    // session transition effect survives and owns the reset.
    mocks.params = {
      agentId: "agent-1",
      projectId: undefined,
      agentInstanceId: undefined,
    };
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s1",
    });
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
    };
    // Pretend the s1 panel left two events in the shared stream slot —
    // simulates the post-hydrate state when the user is actively
    // viewing s1's transcript.
    mocks.streamState = {
      entries: {
        "p1:i1": { events: [{ id: "e1" }, { id: "e2" }] },
      },
    };

    const { rerender } = render(<AgentChatView />);
    const panel = screen.getByTestId("chat-panel");
    // First mount must not clear; the panel effect only fires on a true
    // cross-session prop change.
    expect(mocks.resetEvents).not.toHaveBeenCalled();

    // User clicks s2 in the sidekick: URL flips to the new session,
    // but the cache for s2 has not landed yet. The resolver still returns
    // the concrete project target, so the project panel stays mounted.
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
      "session:p1:i1:s2": { status: "loading" },
    };
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s2",
    });
    rerender(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBe(panel);
    expect(mocks.resetEvents).toHaveBeenCalledWith([], { allowWhileStreaming: true });
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        historyResolved: false,
        isLoading: true,
        scrollResetKey: "i1:s2",
        transcriptKey: "session:p1:i1:s2",
      }),
    );

    // s2 events arrive in the cache → the same panel resolves in place.
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
      "session:p1:i1:s2": { status: "ready" },
    };
    rerender(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBe(panel);
  });

  it("does not clear the shared stream slot mid-stream on a cross-session URL change", () => {
    // SessionReady's URL flip (null → defined) and any other transition
    // that lands while a turn is actively streaming on the same
    // project-agent must keep the live stream events. The resolver
    // panel's `prevSessionIdRef` effect gates on `getIsStreaming` to
    // honour the same invariant while staying mounted in the agents shell.
    mocks.params = {
      agentId: "agent-1",
      projectId: undefined,
      agentInstanceId: undefined,
    };
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s1",
    });
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
    };
    mocks.streamState = {
      entries: {
        "p1:i1": { events: [{ id: "e1" }, { id: "e2" }] },
      },
    };

    const { rerender } = render(<AgentChatView />);
    const panel = screen.getByTestId("chat-panel");
    mocks.resetEvents.mockClear();

    mocks.getIsStreaming.mockImplementation(() => true);
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s2",
    });
    rerender(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBe(panel);
    expect(mocks.resetEvents).not.toHaveBeenCalled();
    expect(mocks.streamState.entries["p1:i1"].events).toHaveLength(2);
  });

  it("keeps the project fresh-canvas panel after the user clicks + (drops ?session=)", async () => {
    // Regression: clicking "+" in the chat input bar fires
    // `handleNewChat`, which strips `?session=` from the URL with the
    // explicit intent of starting a fresh chat. Before the resolver
    // gained `userClearedSession` detection, the agents-shell route
    // would lock on a blank `lanePlaceholder` div forever:
    //   - `urlTarget` requires a `?session=` to resolve → null.
    //   - `fallbackTarget` still resolves to the just-abandoned
    //     `mostRecent` session.
    //   - Resolver returned `kind: "placeholder"`.
    //   - `useDefaultStandaloneSessionRedirect`'s `didDefaultRef` was
    //     already stamped from the prior render, so it never re-pushed
    //     a session into the URL — the placeholder never lifted.
    // After the fix, the resolver detects "previously had a session,
    // now URL has none" and keeps the project panel mounted with a
    // null session so the stream that `+` armed sends `new_session: true`.
    mocks.params = {
      agentId: "agent-1",
      projectId: undefined,
      agentInstanceId: undefined,
    };
    mocks.projectsState = {
      projects: [{ project_id: "p1", name: "P1" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }],
      },
    };
    mocks.sessionsState = {
      sessionsBySurface: {
        "agent:agent-1": [{ session_id: "s1", _projectId: "p1", _agentInstanceId: "i1" }],
      },
    };
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s1",
    });
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
    };

    const { rerender } = render(<AgentChatView />);

    // First mount: project panel for s1.
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        agentId: "i1",
        streamKey: "project-stream",
      }),
    );

    // User clicks "+" — `handleNewChat` arms the project stream's
    // next send and strips `?session=` from URL.
    act(() => {
      (mocks.latestChatPanelProps?.onNewChat as (() => void) | undefined)?.();
    });
    expect(mocks.markNextSendAsNewSession).toHaveBeenCalledTimes(1);
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
    });
    mocks.latestChatPanelProps = undefined;
    rerender(<AgentChatView />);

    // Project fresh-canvas panel stays mounted (NOT the lane placeholder
    // and not the standalone agent stream, which would lose the latch).
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        agentId: "i1",
        streamKey: "project-stream",
        scrollResetKey: "i1:fresh:1",
        transcriptKey: "fresh:p1:i1:1",
      }),
    );
    expect(mocks.latestHistorySyncOptions).toEqual(
      expect.objectContaining({
        historyKey: "fresh:p1:i1:1",
        suppressHistoryFetch: true,
      }),
    );
    const freshFetchFn = mocks.latestHistorySyncOptions?.fetchFn as
      | (() => Promise<unknown[]>)
      | undefined;
    expect(freshFetchFn).toBeDefined();
    await expect(freshFetchFn?.()).resolves.toEqual([]);

    // After the next send, `handleSessionReady` writes the new session
    // id back into the URL — the resolver should flip back to the
    // project panel for that new session.
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s2",
    });
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
      "session:p1:i1:s2": { status: "ready" },
    };
    mocks.latestChatPanelProps = undefined;
    rerender(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        agentId: "i1",
        streamKey: "project-stream",
      }),
    );
  });

  // Regression coverage for the "user message disappears mid-send"
  // flicker on `ProjectAgentChatPanel`. The session-transition effect
  // must NOT clear the stream slot on the post-`SessionReady` URL flip
  // (null → defined) and must NOT clear during an active stream.
  describe("ProjectAgentChatPanel session-transition effect", () => {
    function mountWithSession(sessionId: string | null) {
      mocks.params = {
        agentId: "agent-1",
        projectId: "p1",
        agentInstanceId: "i1",
      };
      mocks.searchParams = new URLSearchParams(
        sessionId ? { session: sessionId } : {},
      );
      return render(<AgentChatView />);
    }

    it("does not clear the stream when the project panel mounts on a fresh canvas (null session)", () => {
      mountWithSession(null);

      expect(mocks.resetEvents).not.toHaveBeenCalled();
    });

    it("does not clear the stream when the project panel mounts on an existing session", () => {
      mountWithSession("session-A");

      expect(mocks.resetEvents).not.toHaveBeenCalled();
    });

    it("does not clear the stream when sessionId flips null → defined (post-SessionReady URL flip)", () => {
      const { rerender } = mountWithSession(null);
      mocks.resetEvents.mockClear();

      // Simulate the `SessionReady` URL update mid-stream.
      mocks.searchParams = new URLSearchParams({ session: "session-A" });
      rerender(<AgentChatView />);

      expect(mocks.resetEvents).not.toHaveBeenCalled();
    });

    it("does not clear the stream when sessionId flips defined → null (handleNewChat path)", () => {
      const { rerender } = mountWithSession("session-A");
      mocks.resetEvents.mockClear();

      // Simulate clicking "+" — `handleNewChat` already calls
      // `resetEvents` directly, so this transition effect should stay
      // out of the way.
      mocks.searchParams = new URLSearchParams();
      rerender(<AgentChatView />);

      expect(mocks.resetEvents).not.toHaveBeenCalled();
    });

    it("does not clear the stream during an active turn even on a cross-session URL change", () => {
      const { rerender } = mountWithSession("session-A");
      mocks.resetEvents.mockClear();
      mocks.getIsStreaming.mockImplementation(() => true);

      mocks.searchParams = new URLSearchParams({ session: "session-B" });
      rerender(<AgentChatView />);

      expect(mocks.resetEvents).not.toHaveBeenCalled();
    });

    it("clears the stream on a true cross-session navigation when idle", () => {
      const { rerender } = mountWithSession("session-A");
      mocks.resetEvents.mockClear();

      mocks.searchParams = new URLSearchParams({ session: "session-B" });
      rerender(<AgentChatView />);

      expect(mocks.resetEvents).toHaveBeenCalledWith([], { allowWhileStreaming: true });
    });
  });

  describe("ProjectAgentChatPanel handleNewChat (chat-input '+')", () => {
    // Regression coverage for the "fresh canvas still shows old
    // messages" bug. After `handleNewChat` strips `?session=` from the
    // URL the next mount reads from a *destination* history key —
    // either `projectChatHistoryKey(...)` on the project route or
    // `agentHistoryKey(...)` after the agents-shell resolver swaps to
    // the standalone panel. If neither of those is cleared,
    // `useChatHistorySync` re-fetches and the agent-wide event window
    // (or the project-route persisted blob) leaks back onto what
    // should be a blank canvas. The tests below assert that
    // `handleNewChat` clears every destination key plus the standalone
    // stream slot, and surfaces the optimistic "New chat" placeholder
    // in the agents-shell sidekick.
    function mountProjectPanel({
      projectId,
      agentInstanceId,
      sessionId,
      agentId = "agent-1",
    }: {
      projectId: string;
      agentInstanceId: string;
      sessionId: string | null;
      agentId?: string;
    }) {
      mocks.params = { agentId: undefined, projectId, agentInstanceId };
      mocks.searchParams = new URLSearchParams(sessionId ? { session: sessionId } : {});
      mocks.projectsState = {
        projects: [{ project_id: projectId, name: projectId.toUpperCase() }],
        agentsByProject: {
          [projectId]: [{ agent_instance_id: agentInstanceId, agent_id: agentId }],
        },
      };
      return render(<AgentChatView />);
    }

    function fireNewChat() {
      const onNewChat = mocks.latestChatPanelProps?.onNewChat as
        | (() => void)
        | undefined;
      if (!onNewChat) throw new Error("onNewChat was not forwarded to ChatPanel");
      act(() => {
        onNewChat();
      });
    }

    it("clears the project + agent destination history keys and the standalone stream slot", () => {
      mocks.streamState = {
        entries: {
          // Standalone panel's stream slot keyed by org agent id.
          "agent-1": { events: [{ id: "e1" }, { id: "e2" }] },
        },
      };

      mountProjectPanel({ projectId: "p1", agentInstanceId: "i1", sessionId: "s1" });

      fireNewChat();

      const clearedKeys = mocks.clearHistory.mock.calls.map((call) => call[0]);
      // Three keys cleared: the current `historyKey` (session-scoped)
      // plus both destination keys (`project:...` and `agent:...`).
      expect(clearedKeys).toContain("session:p1:i1:s1");
      expect(clearedKeys).toContain("project:p1:i1");
      expect(clearedKeys).toContain("agent:agent-1");

      // Standalone stream slot wiped so a swap to `StandaloneAgentChatPanel`
      // can't resurrect stale events on the fresh canvas.
      expect(mocks.streamState.entries["agent-1"].events).toHaveLength(0);
    });

    it("uses a transient empty transcript after + drops the project route session", async () => {
      const { rerender } = mountProjectPanel({
        projectId: "p1",
        agentInstanceId: "i1",
        sessionId: "s1",
      });

      fireNewChat();
      mocks.searchParams = new URLSearchParams();
      rerender(<AgentChatView />);

      expect(mocks.latestChatPanelProps).toEqual(
        expect.objectContaining({
          agentId: "i1",
          scrollResetKey: "i1:fresh:1",
          streamKey: "project-stream",
          transcriptKey: "fresh:p1:i1:1",
        }),
      );
      expect(mocks.latestHistorySyncOptions).toEqual(
        expect.objectContaining({
          historyKey: "fresh:p1:i1:1",
          suppressHistoryFetch: true,
        }),
      );
      const fetchFn = mocks.latestHistorySyncOptions?.fetchFn as
        | (() => Promise<unknown[]>)
        | undefined;
      expect(fetchFn).toBeDefined();
      await expect(fetchFn?.()).resolves.toEqual([]);
    });

    it("does not clear the standalone stream slot while a turn is actively streaming", () => {
      mocks.streamState = {
        entries: {
          "agent-1": { events: [{ id: "e1" }] },
        },
      };
      mocks.getIsStreaming.mockImplementation(() => true);

      mountProjectPanel({ projectId: "p1", agentInstanceId: "i1", sessionId: "s1" });
      fireNewChat();

      // Stream slot preserved for the in-flight turn — clearing here
      // would erase the optimistic user bubble. Keys are still
      // cleared because they only wipe persisted history, not live
      // stream state.
      expect(mocks.streamState.entries["agent-1"].events).toHaveLength(1);
    });

    it("does not create a sidekick row before the first message is sent", () => {
      mountProjectPanel({ projectId: "p1", agentInstanceId: "i1", sessionId: "s1" });

      fireNewChat();

      expect(mocks.bumpVersion).toHaveBeenCalledTimes(1);
      expect(mocks.sessionsState.sessionsBySurface).toEqual({});
    });

    it("inserts an optimistic sidekick row the moment the user sends after +", () => {
      // Regression: until this wiring landed the new session only
      // showed up after the SSE `SessionReady` round-trip + a
      // `bumpVersion`-triggered refetch. The user's expectation is
      // that pressing Enter immediately drops a "New chat" row in
      // the sidekick.
      mountProjectPanel({
        projectId: "p1",
        agentInstanceId: "i1",
        sessionId: null,
      });

      fireNewChat();
      // The send wrapper consumes the latch and calls
      // `addOptimisticSession` on both the agents-app surface
      // (`agent:agent-1`) and the projects-app surface
      // (`project:p1`).
      const onSend = mocks.latestChatPanelProps?.onSend as
        | ((content: string) => void)
        | undefined;
      if (!onSend) throw new Error("onSend was not forwarded to ChatPanel");
      act(() => {
        onSend("hello");
      });

      expect(mocks.addOptimisticSession).toHaveBeenCalledTimes(2);
      const surfaceKeys = mocks.addOptimisticSession.mock.calls.map(
        (call) => call[0],
      );
      expect(surfaceKeys).toContain("agent:agent-1");
      expect(surfaceKeys).toContain("project:p1");

      const agentSurface = mocks.sessionsState.sessionsBySurface["agent:agent-1"];
      const projectSurface = mocks.sessionsState.sessionsBySurface["project:p1"];
      expect(agentSurface?.[0]?.session_id).toMatch(/^optimistic:/);
      expect(projectSurface?.[0]?.session_id).toMatch(/^optimistic:/);
      expect(agentSurface?.[0]?.session_id).toBe(projectSurface?.[0]?.session_id);
    });

    it("swaps the optimistic id for the real one when SessionReady arrives", () => {
      mountProjectPanel({
        projectId: "p1",
        agentInstanceId: "i1",
        sessionId: null,
      });

      fireNewChat();
      const onSend = mocks.latestChatPanelProps?.onSend as
        | ((content: string) => void)
        | undefined;
      if (!onSend) throw new Error("onSend was not forwarded to ChatPanel");
      act(() => {
        onSend("hello");
      });

      const optimisticId =
        mocks.sessionsState.sessionsBySurface["agent:agent-1"]?.[0]?.session_id;
      expect(optimisticId).toMatch(/^optimistic:/);

      // The chat panel registers `onSessionReady` with `useChatStream`.
      // Simulate the SSE event landing.
      const onSessionReady = mocks.capturedOnSessionReady;
      if (!onSessionReady) throw new Error("onSessionReady was not registered");
      act(() => {
        onSessionReady("real-session-id");
      });

      expect(mocks.replaceSessionId).toHaveBeenCalledWith(
        "agent:agent-1",
        optimisticId,
        "real-session-id",
      );
      expect(mocks.replaceSessionId).toHaveBeenCalledWith(
        "project:p1",
        optimisticId,
        "real-session-id",
      );
      expect(
        mocks.sessionsState.sessionsBySurface["agent:agent-1"]?.[0]?.session_id,
      ).toBe("real-session-id");
      expect(
        mocks.sessionsState.sessionsBySurface["project:p1"]?.[0]?.session_id,
      ).toBe("real-session-id");
    });

    it("only inserts an optimistic row on the first send after +, not on subsequent sends", () => {
      mountProjectPanel({
        projectId: "p1",
        agentInstanceId: "i1",
        sessionId: null,
      });

      fireNewChat();
      const onSend = mocks.latestChatPanelProps?.onSend as
        | ((content: string) => void)
        | undefined;
      if (!onSend) throw new Error("onSend was not forwarded to ChatPanel");
      act(() => {
        onSend("hello");
      });
      mocks.addOptimisticSession.mockClear();
      // Second send on the same fresh-canvas should not insert another
      // row — the latch was consumed by the first send.
      act(() => {
        onSend("follow up");
      });

      expect(mocks.addOptimisticSession).not.toHaveBeenCalled();
    });

    it("does not insert an optimistic row when sending without pressing + first", () => {
      mountProjectPanel({
        projectId: "p1",
        agentInstanceId: "i1",
        sessionId: "s1",
      });

      const onSend = mocks.latestChatPanelProps?.onSend as
        | ((content: string) => void)
        | undefined;
      if (!onSend) throw new Error("onSend was not forwarded to ChatPanel");
      act(() => {
        onSend("hello");
      });

      expect(mocks.addOptimisticSession).not.toHaveBeenCalled();
    });

    it("still resets history when the org agent_id lookup misses (unbound instance)", () => {
      // Edge case: a session URL points to a `(project, instance)`
      // pair the projects store hasn't loaded yet (or that's a stale
      // pointer to a deleted instance). The local reset should still
      // clear the known session/project history keys.
      mocks.params = { agentId: undefined, projectId: "p1", agentInstanceId: "i1" };
      mocks.searchParams = new URLSearchParams({ session: "s1" });
      mocks.projectsState = { projects: [], agentsByProject: {} };

      render(<AgentChatView />);
      fireNewChat();

      const clearedKeys = mocks.clearHistory.mock.calls.map((call) => call[0]);
      expect(clearedKeys).toContain("session:p1:i1:s1");
      expect(clearedKeys).toContain("project:p1:i1");
      // No `agent:...` clear because `orgAgentId` did not resolve.
      expect(clearedKeys.find((k) => k.startsWith("agent:"))).toBeUndefined();
    });
  });
});
