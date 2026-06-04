import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationSurfaceHost } from "./ConversationSurfaceHost";

type FakeProject = { project_id: string; name: string };
type FakeAgentInstance = { agent_instance_id: string; agent_id: string };
type FakeAnnotatedSession = {
  session_id: string;
  _projectId: string;
  _agentInstanceId: string;
};

const mocks = vi.hoisted(() => ({
  pathname: "/agents/agent-1",
  search: "",
  setSearchParams: vi.fn(),
  agentChatMounts: 0,
  standaloneMounts: 0,
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
  loadProjectSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: mocks.pathname, search: mocks.search, state: null }),
  useSearchParams: () => [new URLSearchParams(mocks.search), mocks.setSearchParams],
  useNavigate: () => vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  cn: (...classNames: Array<string | false | null | undefined>) =>
    classNames.filter(Boolean).join(" "),
}));

// The external-system sync (terminal target / selected agent) is covered
// separately; stub it so this suite focuses on target resolution + keying.
vi.mock("./use-conversation-surface-sync", () => ({
  useConversationSurfaceSync: () => {},
}));

vi.mock("../../api/client", () => ({
  api: { listSessionEvents: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../apps/agents/components/AgentChatPanel", () => ({
  AgentChatPanel: (props: Record<string, unknown>) => {
    // Count mounts (not renders) so the no-remount assertion is meaningful.
    const React = require("react") as typeof import("react");
    React.useEffect(() => {
      mocks.agentChatMounts += 1;
    }, []);
    return <div data-testid="agent-chat-panel" data-props={JSON.stringify(props)} />;
  },
}));

vi.mock("../../apps/agents/components/StandaloneAgentChatPanel", () => ({
  StandaloneAgentChatPanel: (props: Record<string, unknown>) => {
    const React = require("react") as typeof import("react");
    React.useEffect(() => {
      mocks.standaloneMounts += 1;
    }, []);
    return (
      <div data-testid="standalone-agent-chat-panel" data-props={JSON.stringify(props)} />
    );
  },
}));

vi.mock("../SessionsList/use-default-session-redirect", () => ({
  useDefaultStandaloneSessionRedirect: () => {},
}));

vi.mock("../../stores/chat-handoff-store", () => ({
  useChatHandoffStore: () => vi.fn(),
}));

vi.mock("../../utils/chat-handoff", () => ({
  isCreateAgentChatHandoff: () => false,
  projectAgentHandoffTarget: vi.fn(),
  standaloneAgentHandoffTarget: vi.fn(),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (
    selector: (state: {
      projects: FakeProject[];
      agentsByProject: Record<string, FakeAgentInstance[]>;
    }) => unknown,
  ) =>
    selector({
      projects: mocks.projectsState.projects,
      agentsByProject: mocks.projectsState.agentsByProject,
    }),
}));

vi.mock("../../stores/sessions-list-store", () => {
  type FakeState = {
    sessionsBySurface: Record<string, FakeAnnotatedSession[]>;
    loadProjectSessions: typeof mocks.loadProjectSessions;
  };
  const hook: ((selector: (state: FakeState) => unknown) => unknown) & {
    getState: () => FakeState;
  } = Object.assign(
    (selector: (state: FakeState) => unknown) =>
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
    isOptimisticSessionId: (id: string) => id.startsWith("optimistic:"),
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
    useSessionsListStore: hook,
  };
});

vi.mock("../../stores/chat-history-store", () => ({
  sessionHistoryKey: (
    projectId: string,
    agentInstanceId: string,
    sessionId: string,
  ) => `session:${projectId}:${agentInstanceId}:${sessionId}`,
  useChatHistoryStore: Object.assign(
    (selector: (state: { entries: Record<string, unknown> }) => unknown) =>
      selector({ entries: {} }),
    { getState: () => ({ entries: {}, fetchHistory: vi.fn() }) },
  ),
}));

function bindAgentToProject(): void {
  mocks.projectsState = {
    projects: [{ project_id: "p1", name: "P1" }],
    agentsByProject: { p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }] },
  };
}

beforeEach(() => {
  mocks.pathname = "/agents/agent-1";
  mocks.search = "";
  mocks.setSearchParams.mockReset();
  mocks.agentChatMounts = 0;
  mocks.standaloneMounts = 0;
  mocks.projectsState = { projects: [], agentsByProject: {} };
  mocks.sessionsState = { sessionsBySurface: {} };
  mocks.bindingsLoadStatusByAgent = {};
  mocks.loadProjectSessions.mockClear();
});

describe("ConversationSurfaceHost", () => {
  it("renders nothing off a conversation route with no held lane", () => {
    mocks.pathname = "/projects";
    const { container } = render(<ConversationSurfaceHost />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the empty standalone panel when the agent has no bindings", () => {
    render(<ConversationSurfaceHost />);
    expect(screen.getByTestId("standalone-agent-chat-panel")).toBeInTheDocument();
  });

  it("renders the project chat panel for a most-recent session under the agents shell", () => {
    bindAgentToProject();
    mocks.sessionsState = {
      sessionsBySurface: {
        "agent:agent-1": [{ session_id: "s1", _projectId: "p1", _agentInstanceId: "i1" }],
      },
    };
    render(<ConversationSurfaceHost />);
    expect(screen.getByTestId("agent-chat-panel")).toBeInTheDocument();
  });

  it("renders the project chat panel for a project path", () => {
    mocks.pathname = "/projects/p1/agents/i1";
    mocks.search = "session=s1";
    bindAgentToProject();
    render(<ConversationSurfaceHost />);
    const props = JSON.parse(
      screen.getByTestId("agent-chat-panel").getAttribute("data-props") ?? "{}",
    ) as Record<string, unknown>;
    expect(props.projectId).toBe("p1");
    expect(props.agentInstanceId).toBe("i1");
    expect(props.sessionId).toBe("s1");
  });

  it("renders the lane placeholder while bindings are loading", () => {
    mocks.bindingsLoadStatusByAgent = { "agent-1": "loading" };
    render(<ConversationSurfaceHost />);
    expect(screen.queryByTestId("agent-chat-panel")).toBeNull();
    expect(screen.queryByTestId("standalone-agent-chat-panel")).toBeNull();
  });

  it("keeps the same AgentChatPanel mounted when switching Projects -> Agents on the same lane", () => {
    bindAgentToProject();
    mocks.sessionsState = {
      sessionsBySurface: {
        "project:p1": [{ session_id: "s1", _projectId: "p1", _agentInstanceId: "i1" }],
        "agent:agent-1": [{ session_id: "s1", _projectId: "p1", _agentInstanceId: "i1" }],
      },
    };

    // Start on the project chat lane.
    mocks.pathname = "/projects/p1/agents/i1";
    mocks.search = "session=s1";
    const { rerender } = render(<ConversationSurfaceHost />);
    expect(screen.getByTestId("agent-chat-panel")).toBeInTheDocument();
    expect(mocks.agentChatMounts).toBe(1);

    // Switch to the agents shell, same (project, instance, session) lane.
    mocks.pathname = "/agents/agent-1";
    mocks.search = "project=p1&instance=i1&session=s1";
    rerender(<ConversationSurfaceHost />);

    expect(screen.getByTestId("agent-chat-panel")).toBeInTheDocument();
    // Same lane key => no remount.
    expect(mocks.agentChatMounts).toBe(1);
  });

  it("remounts for a genuinely different agent instance", () => {
    bindAgentToProject();
    mocks.sessionsState = {
      sessionsBySurface: {
        "project:p1": [
          { session_id: "s1", _projectId: "p1", _agentInstanceId: "i1" },
          { session_id: "s2", _projectId: "p1", _agentInstanceId: "i2" },
        ],
      },
    };

    mocks.pathname = "/projects/p1/agents/i1";
    mocks.search = "session=s1";
    const { rerender } = render(<ConversationSurfaceHost />);
    expect(mocks.agentChatMounts).toBe(1);

    mocks.pathname = "/projects/p1/agents/i2";
    mocks.search = "session=s2";
    rerender(<ConversationSurfaceHost />);
    expect(mocks.agentChatMounts).toBe(2);
  });
});
