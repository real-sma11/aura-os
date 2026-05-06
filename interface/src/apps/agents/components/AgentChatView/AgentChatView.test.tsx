import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { AgentChatView } from "./AgentChatView";

type FakeProject = { project_id: string; name: string };
type FakeAgentInstance = { agent_instance_id: string; agent_id: string };

const mocks = vi.hoisted(() => ({
  params: { agentId: "agent-1", projectId: undefined, agentInstanceId: undefined } as {
    agentId?: string;
    projectId?: string;
    agentInstanceId?: string;
  },
  searchParams: new URLSearchParams(),
  isMobileLayout: false,
  latestChatPanelProps: undefined as Record<string, unknown> | undefined,
  latestHistorySyncOptions: undefined as Record<string, unknown> | undefined,
  setSelectedAgent: vi.fn(),
  sendMessage: vi.fn(),
  stopStreaming: vi.fn(),
  resetEvents: vi.fn(),
  markNextSendAsNewSession: vi.fn(),
  // Stores controlled per-test so we can exercise the defer-render gate
  // for "redirect is about to fire" without spinning up the real stores.
  projectsState: {
    projects: [] as FakeProject[],
    agentsByProject: {} as Record<string, FakeAgentInstance[]>,
  },
  sessionsState: {
    sessionsBySurface: {} as Record<string, unknown[]>,
  },
  defaultStandaloneRedirect: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => mocks.params,
  useLocation: () => ({ state: null }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [mocks.searchParams, vi.fn()],
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
  useChatStream: () => ({
    streamKey: "project-stream",
    sendMessage: mocks.sendMessage,
    stopStreaming: mocks.stopStreaming,
    resetEvents: mocks.resetEvents,
    markNextSendAsNewSession: mocks.markNextSendAsNewSession,
  }),
}));

vi.mock("../../../../hooks/use-chat-history-sync", () => ({
  useChatHistorySync: (options: Record<string, unknown>) => {
    mocks.latestHistorySyncOptions = options;
    return {
      historyMessages: [],
      historyResolved: true,
      isLoading: false,
      historyError: null,
      wrapSend: (fn: (...args: unknown[]) => unknown) => fn,
    };
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

vi.mock("../../../../stores/sessions-list-store", () => ({
  agentSessionsSurfaceKey: (agentId: string) => `agent:${agentId}`,
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
  useSessionsListStore: (selector: (state: { sessionsBySurface: Record<string, unknown[]>; bumpVersion: () => void }) => unknown) =>
    selector({
      sessionsBySurface: mocks.sessionsState.sessionsBySurface,
      bumpVersion: vi.fn(),
    }),
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
    mocks.isMobileLayout = false;
    mocks.latestChatPanelProps = undefined;
    mocks.latestHistorySyncOptions = undefined;
    mocks.projectsState = { projects: [], agentsByProject: {} };
    mocks.sessionsState = { sessionsBySurface: {} };
    mocks.defaultStandaloneRedirect.mockReset();
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

  it("renders the lane placeholder while a default-session redirect is pending (cached sessions)", () => {
    // Agent has bindings AND its sessions surface already holds a row, so the
    // redirect hook is going to write `?session=` into the URL on the very
    // next tick. Mounting `StandaloneAgentChatPanel` here would fire its
    // per-agent history fetch and produce a flicker when the URL settles
    // and `ProjectAgentChatPanel` swaps in.
    mocks.projectsState = {
      projects: [{ project_id: "p1", name: "P1" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }],
      },
    };
    mocks.sessionsState = {
      sessionsBySurface: {
        "agent:agent-1": [{ session_id: "s1" }],
      },
    };

    render(<AgentChatView />);

    expect(screen.queryByTestId("chat-panel")).toBeNull();
    expect(mocks.latestChatPanelProps).toBeUndefined();
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

  it("renders the project panel directly when the URL already carries session params (no defer)", () => {
    // When the user clicks a session row in the sidekick, the URL carries
    // `?project=&instance=&session=` from the start so the agents-shell
    // session branch should render `ProjectAgentChatPanel` immediately,
    // even when the standalone surface is in the "redirect imminent" state.
    mocks.projectsState = {
      projects: [{ project_id: "p1", name: "P1" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "i1", agent_id: "agent-1" }],
      },
    };
    mocks.sessionsState = {
      sessionsBySurface: {
        "agent:agent-1": [{ session_id: "s1" }],
      },
    };
    mocks.searchParams = new URLSearchParams({
      project: "p1",
      instance: "i1",
      session: "s1",
    });

    render(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });
});
