import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { AgentChatRoute } from "./AgentChatRoute";

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
  fetchHistory: vi.fn(),
  defaultStandaloneRedirect: vi.fn(),
  projectsState: {
    projects: [] as FakeProject[],
    agentsByProject: {} as Record<string, FakeAgentInstance[]>,
  },
  sessionsState: {
    sessionsBySurface: {} as Record<string, FakeAnnotatedSession[]>,
  },
  bindingsLoadStatusByAgent: {} as Record<
    string,
    "idle" | "loading" | "loaded" | "error"
  >,
  historyEntries: {} as Record<string, FakeHistoryEntry>,
  loadProjectSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => mocks.params,
  useLocation: () => ({ state: null }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock("../../../../api/client", () => ({
  api: {
    listSessionEvents: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../AgentChatPanel", () => ({
  AgentChatPanel: (props: Record<string, unknown>) => (
    <div data-testid="agent-chat-panel" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("../StandaloneAgentChatPanel", () => ({
  StandaloneAgentChatPanel: (props: Record<string, unknown>) => (
    <div data-testid="standalone-agent-chat-panel" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock(
  "../../../../components/SessionsList/use-default-session-redirect",
  () => ({
    useDefaultStandaloneSessionRedirect: (...args: unknown[]) =>
      mocks.defaultStandaloneRedirect(...args),
    useDefaultProjectSessionRedirect: vi.fn(),
  }),
);

vi.mock("../../../../stores/chat-handoff-store", () => ({
  useChatHandoffStore: () => vi.fn(),
}));

vi.mock("../../../../utils/chat-handoff", () => ({
  isCreateAgentChatHandoff: () => false,
  projectAgentHandoffTarget: vi.fn(),
  standaloneAgentHandoffTarget: vi.fn(),
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { projects: FakeProject[]; agentsByProject: Record<string, FakeAgentInstance[]> }) => unknown) =>
    selector({
      projects: mocks.projectsState.projects,
      agentsByProject: mocks.projectsState.agentsByProject,
    }),
}));

vi.mock("../../../../stores/sessions-list-store", () => {
  type FakeSessionsListState = {
    sessionsBySurface: Record<string, FakeAnnotatedSession[]>;
    loadProjectSessions: typeof mocks.loadProjectSessions;
  };
  const sessionsHook: ((selector: (state: FakeSessionsListState) => unknown) => unknown) & {
    getState: () => FakeSessionsListState;
  } = Object.assign(
    (selector: (state: FakeSessionsListState) => unknown) =>
      selector({
        sessionsBySurface: mocks.sessionsState.sessionsBySurface,
        loadProjectSessions: mocks.loadProjectSessions,
      }),
    {
      getState: () => ({
        sessionsBySurface: mocks.sessionsState.sessionsBySurface,
        loadProjectSessions: mocks.loadProjectSessions,
      }),
    },
  );
  return {
    agentSessionsSurfaceKey: (agentId: string) => `agent:${agentId}`,
    findMostRecentRealSessionForInstance: (
      sessions: FakeAnnotatedSession[] | undefined,
      agentInstanceId: string | undefined,
    ) => {
      if (!agentInstanceId || !sessions) return null;
      return (
        sessions.find(
          (s) =>
            s._agentInstanceId === agentInstanceId &&
            !s.session_id.startsWith("optimistic:"),
        ) ?? null
      );
    },
    projectSessionsSurfaceKey: (projectId: string) => `project:${projectId}`,
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
      return parts.sort().join(",");
    },
    useAgentBindingsLoadStatus: (agentId: string | undefined) => {
      if (!agentId) return "idle";
      return mocks.bindingsLoadStatusByAgent[agentId] ?? "loaded";
    },
    useMostRecentSession: (surfaceKey: string | undefined) => {
      if (!surfaceKey) return null;
      const list = mocks.sessionsState.sessionsBySurface[surfaceKey];
      return list?.find((s) => !s.session_id.startsWith("optimistic:")) ?? null;
    },
    useSessionsListStore: sessionsHook,
  };
});

vi.mock("../../../../stores/chat-history-store", () => ({
  sessionHistoryKey: (
    projectId: string,
    agentInstanceId: string,
    sessionId: string,
  ) => `session:${projectId}:${agentInstanceId}:${sessionId}`,
  useChatHistoryStore: Object.assign(
    (selector: (state: { entries: Record<string, FakeHistoryEntry> }) => unknown) =>
      selector({ entries: mocks.historyEntries }),
    {
      getState: () => ({
        entries: mocks.historyEntries,
        fetchHistory: mocks.fetchHistory,
      }),
    },
  ),
}));

describe("AgentChatRoute", () => {
  beforeEach(() => {
    mocks.params = { agentId: "agent-1", projectId: undefined, agentInstanceId: undefined };
    mocks.searchParams = new URLSearchParams();
    mocks.setSearchParams.mockReset();
    mocks.isMobileLayout = false;
    mocks.projectsState = { projects: [], agentsByProject: {} };
    mocks.sessionsState = { sessionsBySurface: {} };
    mocks.historyEntries = {};
    mocks.bindingsLoadStatusByAgent = {};
    mocks.fetchHistory.mockReset();
    mocks.loadProjectSessions.mockClear();
    mocks.defaultStandaloneRedirect.mockReset();
  });

  it("renders the empty standalone panel when the agent has no bindings", () => {
    render(<AgentChatRoute />);

    expect(screen.getByTestId("standalone-agent-chat-panel")).toBeInTheDocument();
  });

  it("renders the project panel for a most-recent session under the agents shell", () => {
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

    render(<AgentChatRoute />);

    expect(screen.getByTestId("agent-chat-panel")).toBeInTheDocument();
  });

  it("renders the project panel when path carries (projectId, agentInstanceId)", () => {
    mocks.params = {
      projectId: "p1",
      agentInstanceId: "i1",
      agentId: undefined,
    };
    mocks.searchParams = new URLSearchParams("session=s1");
    mocks.projectsState = {
      projects: [{ project_id: "p1", name: "P1" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }],
      },
    };

    render(<AgentChatRoute />);

    expect(screen.getByTestId("agent-chat-panel")).toBeInTheDocument();
  });

  it("renders the lane placeholder while bindings are loading", () => {
    mocks.bindingsLoadStatusByAgent = { "agent-1": "loading" };

    render(<AgentChatRoute />);

    expect(screen.queryByTestId("agent-chat-panel")).toBeNull();
    expect(screen.queryByTestId("standalone-agent-chat-panel")).toBeNull();
  });

  it("warms the chat-history-store for the resolved redirect target", () => {
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

    render(<AgentChatRoute />);

    expect(mocks.fetchHistory).toHaveBeenCalledWith(
      "session:p1:i1:s1",
      expect.any(Function),
    );
  });

  it("skips optimistic project sessions when defaulting and warming history", () => {
    mocks.params = {
      projectId: "p1",
      agentInstanceId: "i1",
      agentId: undefined,
    };
    mocks.sessionsState = {
      sessionsBySurface: {
        "project:p1": [
          {
            session_id: "optimistic:pending",
            _projectId: "p1",
            _agentInstanceId: "i1",
          },
          { session_id: "real-1", _projectId: "p1", _agentInstanceId: "i1" },
        ],
      },
    };

    render(<AgentChatRoute />);

    const props = JSON.parse(
      screen.getByTestId("agent-chat-panel").getAttribute("data-props") ?? "{}",
    ) as Record<string, unknown>;
    expect(props.sessionId).toBe("real-1");
    expect(mocks.fetchHistory).toHaveBeenCalledWith(
      "session:p1:i1:real-1",
      expect.any(Function),
    );
    expect(mocks.fetchHistory).not.toHaveBeenCalledWith(
      "session:p1:i1:optimistic:pending",
      expect.any(Function),
    );

    const updater = mocks.setSearchParams.mock.calls[0][0] as (
      prev: URLSearchParams,
    ) => URLSearchParams;
    const next = updater(new URLSearchParams());
    expect(next.get("session")).toBe("real-1");
  });

  it("keeps the previous ready panel mounted while a clicked session is cold-loading", () => {
    mocks.params = { agentId: "agent-1", projectId: undefined, agentInstanceId: undefined };
    mocks.searchParams = new URLSearchParams("project=p1&instance=i1&session=s1");
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
    };

    const { rerender } = render(<AgentChatRoute />);

    let props = JSON.parse(
      screen.getByTestId("agent-chat-panel").getAttribute("data-props") ?? "{}",
    ) as Record<string, unknown>;
    expect(props.sessionId).toBe("s1");

    mocks.searchParams = new URLSearchParams("project=p1&instance=i1&session=s2");
    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
      "session:p1:i1:s2": { status: "loading" },
    };
    rerender(<AgentChatRoute />);

    props = JSON.parse(
      screen.getByTestId("agent-chat-panel").getAttribute("data-props") ?? "{}",
    ) as Record<string, unknown>;
    expect(props.sessionId).toBe("s1");

    mocks.historyEntries = {
      "session:p1:i1:s1": { status: "ready" },
      "session:p1:i1:s2": { status: "ready" },
    };
    rerender(<AgentChatRoute />);

    props = JSON.parse(
      screen.getByTestId("agent-chat-panel").getAttribute("data-props") ?? "{}",
    ) as Record<string, unknown>;
    expect(props.sessionId).toBe("s2");
  });
});
