import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { DesktopShell } from "../DesktopShell";
import { SIDEKICK_STORAGE_KEY } from "./desktop-shell-sidekick";

const LEGACY_SHARED_KEY = "aura-sidekick-v2";
const LEGACY_PROJECTS_KEY = "aura-projects-sidekick-v1";
const LEGACY_PER_APP_PREFIX = "aura-sidekick-width:";

function legacyPerAppKey(appId: string) {
  return `${LEGACY_PER_APP_PREFIX}${appId}`;
}

function createMockApp(id: string, label: string, basePath: string) {
  return {
    id,
    label,
    basePath,
    LeftPanel: () => <div data-testid="left-panel" data-app={id} />,
    MainPanel: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="main-panel">{children}</div>
    ),
    SidekickPanel: () => <div data-testid="sidekick-panel" data-app={id} />,
    SidekickTaskbar: () => <div data-testid="sidekick-taskbar" data-app={id} />,
    SidekickHeader: () => <div data-testid="sidekick-header" data-app={id} />,
    PreviewPanel: () => <div data-testid="preview-panel" data-app={id} />,
    PreviewHeader: () => <div data-testid="preview-header" data-app={id} />,
  };
}

const mockAgentsApp = createMockApp("agents", "Agents", "/agents");
const mockProjectsApp = createMockApp("projects", "Projects", "/projects");
const mockTasksApp = createMockApp("tasks", "Tasks", "/tasks");
const mockProcessApp = createMockApp("process", "Processes", "/process");

const mockDesktopApp = {
  id: "desktop",
  label: "Desktop",
  basePath: "/desktop",
  LeftPanel: () => <div data-testid="left-panel" />,
  MainPanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="main-panel">{children}</div>,
  SidekickTaskbar: () => <div data-testid="sidekick-taskbar" />,
  SidekickHeader: () => <div data-testid="sidekick-header" />,
  PreviewPanel: () => <div data-testid="preview-panel" />,
  PreviewHeader: () => <div data-testid="preview-header" />,
};

let currentActiveApp = mockProjectsApp;
let currentVisitedAppIds = new Set(["projects"]);
let currentSidekickCollapsed = false;
let currentSidekickSplitScreen = false;
const toggleSidekick = vi.fn();
const setSidekickSplitScreen = vi.fn();
const laneRenderSpy = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Topbar: ({ title, actions, icon }: { title?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) => (
    <header data-testid="topbar">{icon}{title}{actions}</header>
  ),
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}{children}</button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Modal: ({ children, isOpen }: { children?: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
  useTheme: () => ({
    theme: "dark",
    accent: "purple",
    resolvedTheme: "dark",
    systemTheme: "dark",
    setTheme: vi.fn(),
    setAccent: vi.fn(),
  }),
  cn: (...args: Array<string | false | null | undefined>) =>
    args.filter(Boolean).join(" "),
}));

vi.mock("../../hooks/use-active-app", () => ({
  useActiveApp: () => currentActiveApp,
  useActiveAppId: () => currentActiveApp.id,
}));

vi.mock("../../stores/app-store", () => ({
  useAppStore: () => ({}),
}));

vi.mock("../../stores/app-ui-store", () => ({
  useAppUIStore: (
    sel: (s: {
      visitedAppIds: Set<string>;
      sidekickCollapsed: boolean;
      sidekickSplitScreen: boolean;
      toggleSidekick: typeof toggleSidekick;
      setSidekickSplitScreen: typeof setSidekickSplitScreen;
    }) => unknown,
  ) =>
    sel({
      visitedAppIds: currentVisitedAppIds,
      sidekickCollapsed: currentSidekickCollapsed,
      sidekickSplitScreen: currentSidekickSplitScreen,
      toggleSidekick,
      setSidekickSplitScreen,
    }),
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: () => ({
    hostSettingsOpen: false,
    openHostSettings: vi.fn(),
    closeHostSettings: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: {
      windowControls: false,
      linkedWorkspace: false,
      nativeUpdater: false,
      hostRetargeting: false,
      ideIntegration: false,
    },
  }),
}));

vi.mock("../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({
    query: "",
    setQuery: vi.fn(),
    action: null,
  }),
}));

const mockSidekickState = { previewItem: null };
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: typeof mockSidekickState) => unknown) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("../../apps/registry", () => ({
  apps: [
    {
      id: "projects",
      label: "Projects",
      basePath: "/projects",
      LeftPanel: () => <div data-testid="left-panel" />,
      DesktopLeftMenuPane: () => <div data-testid="left-panel" />,
      SidekickPanel: () => <div data-testid="sidekick-panel" />,
    },
    {
      id: "tasks",
      label: "Tasks",
      basePath: "/tasks",
      LeftPanel: () => <div data-testid="left-panel" />,
      DesktopLeftMenuPane: () => <div data-testid="left-panel" />,
      SidekickPanel: () => <div data-testid="sidekick-panel" />,
    },
    {
      id: "process",
      label: "Processes",
      basePath: "/process",
      LeftPanel: () => <div data-testid="left-panel" />,
      DesktopLeftMenuPane: () => <div data-testid="left-panel" />,
      SidekickPanel: () => <div data-testid="sidekick-panel" />,
    },
    {
      id: "desktop",
      label: "Desktop",
      basePath: "/desktop",
      LeftPanel: () => <div data-testid="left-panel" />,
    },
  ],
}));

vi.mock("../../apps/agents/components/AgentWindow/AgentWindow", () => ({
  AgentWindow: ({
    win,
    isFocused,
  }: {
    win: { agentId: string; x: number; y: number };
    isFocused: boolean;
  }) => (
    <div
      data-testid="agent-window"
      data-agent-id={win.agentId}
      data-x={win.x}
      data-y={win.y}
      data-focused={String(isFocused)}
    />
  ),
}));

vi.mock("../BottomTaskbar", () => ({
  BottomTaskbar: () => <div data-testid="bottom-taskbar" />,
}));
vi.mock("../EarnCreditsButton", () => ({
  EarnCreditsButton: () => <div data-testid="earn-credits-button" />,
}));
// `DesktopShell` now wraps the active app's `MainPanel` in a persistent
// `ResponsiveMainLane` so the visible middle container survives app switches.
// Mock it as a passthrough so the existing `mainPanelHost` / `main-panel`
// assertions still see the same parent chain.
vi.mock("../ResponsiveMainLane", () => ({
  ResponsiveMainLane: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="responsive-main-lane">{children}</div>
  ),
}));
vi.mock("../Lane", () => ({
  Lane: ({
    children,
    header,
    taskbar,
    resizePosition,
    storageKey,
    defaultWidth = 240,
    collapsed = false,
    animateCollapse = true,
    onResizeEnd,
  }: {
    children?: React.ReactNode;
    header?: React.ReactNode;
    taskbar?: React.ReactNode;
    resizePosition?: "left" | "right";
    storageKey?: string | null;
    defaultWidth?: number;
    collapsed?: boolean;
    animateCollapse?: boolean;
    onResizeEnd?: (size: number) => void;
  }) => {
    laneRenderSpy({ resizePosition, storageKey, defaultWidth, collapsed, animateCollapse, onResizeEnd });

    return (
      <div
        data-testid={resizePosition === "left" ? "sidekick-lane" : "sidebar-lane"}
        data-storage-key={storageKey ?? undefined}
      >
        {header}
        {taskbar}
        {children}
      </div>
    );
  },
}));
vi.mock("../ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../HostSettingsModal", () => ({
  HostSettingsModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="host-settings" /> : null,
}));
vi.mock("../UpdateBanner", () => ({
  UpdateBanner: () => <div data-testid="update-banner" />,
  UpdatePill: () => <div data-testid="update-pill" />,
}));
vi.mock("../PanelSearch", () => ({
  PanelSearch: () => <div data-testid="panel-search" />,
}));
vi.mock("../WindowControls", () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));
vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

vi.mock("./DesktopShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  localStorage.clear();
  useDesktopWindowStore.setState({ windows: {}, nextZ: 1 });
  currentActiveApp = mockProjectsApp;
  currentVisitedAppIds = new Set(["projects"]);
  currentSidekickCollapsed = false;
  currentSidekickSplitScreen = false;
  toggleSidekick.mockClear();
  setSidekickSplitScreen.mockClear();
  laneRenderSpy.mockClear();
});

function renderShell(pathname = "/projects") {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <DesktopShell />
    </MemoryRouter>,
  );
}

function getLatestSidekickLaneProps() {
  const sidekickLaneCalls = laneRenderSpy.mock.calls
    .map(
      ([props]) =>
        props as {
          resizePosition?: "left" | "right";
          storageKey?: string | null;
          defaultWidth?: number;
          collapsed?: boolean;
          animateCollapse?: boolean;
          onResizeEnd?: (size: number) => void;
        },
    )
    .filter((props) => props.resizePosition === "left");

  return sidekickLaneCalls.at(-1);
}

function getAllSidekickLaneProps() {
  return laneRenderSpy.mock.calls
    .map(
      ([props]) =>
        props as {
          resizePosition?: "left" | "right";
          defaultWidth?: number;
        },
    )
    .filter((props) => props.resizePosition === "left");
}

function getLatestSidebarLaneProps() {
  const sidebarLaneCalls = laneRenderSpy.mock.calls
    .map(([props]) => props as { storageKey?: string; defaultWidth?: number; collapsed?: boolean; animateCollapse?: boolean })
    .filter((props) => props.storageKey === "aura-sidebar");

  return sidebarLaneCalls.at(-1);
}

describe("DesktopShell", () => {
  it("renders the AURA title link", () => {
    renderShell();
    expect(screen.getByAltText("AURA")).toBeInTheDocument();
  });

  it("mounts the update pill in the titlebar (not the legacy floating banner)", () => {
    renderShell();
    // The desktop shell now surfaces auto-updates via a compact pill in the
    // titlebar; the bottom-left floating banner only ships on mobile.
    expect(screen.getByTestId("update-pill")).toBeInTheDocument();
    expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument();
  });

  it("renders bottom taskbar", () => {
    renderShell();
    expect(screen.getByTestId("bottom-taskbar")).toBeInTheDocument();
  });

  it("renders main panel from active app", () => {
    renderShell();
    expect(screen.getByTestId("main-panel")).toBeInTheDocument();
  });

  it("renders left panel from active app", () => {
    renderShell();
    expect(screen.getAllByTestId("left-panel").length).toBeGreaterThan(0);
  });

  it("mounts only the active app panels", () => {
    currentActiveApp = mockProjectsApp;
    currentVisitedAppIds = new Set(["projects"]);

    renderShell();

    expect(screen.getAllByTestId("left-panel")).toHaveLength(1);
    expect(screen.getAllByTestId("sidekick-panel")).toHaveLength(1);
    expect(screen.getByTestId("sidekick-panel")).toHaveAttribute("data-app", "projects");
  });

  it("keeps the persistent main panel lane mounted while swapping app content", () => {
    currentActiveApp = mockProjectsApp;
    currentVisitedAppIds = new Set(["projects"]);
    const view = renderShell("/projects");

    // The persistent `ResponsiveMainLane` lives *inside* `mainPanelHost` and
    // wraps the active app's `MainPanel`. Both should keep their DOM identity
    // across app switches so the visible middle container doesn't tear down.
    const mainPanelHost = screen.getByTestId("main-panel").closest(".mainPanelHost");
    const persistentLane = screen.getByTestId("responsive-main-lane");
    expect(mainPanelHost).not.toBeNull();
    expect(persistentLane).not.toBeNull();

    currentActiveApp = mockTasksApp;
    currentVisitedAppIds = new Set(["projects", "tasks"]);
    view.rerender(
      <MemoryRouter initialEntries={["/tasks"]}>
        <DesktopShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("main-panel").closest(".mainPanelHost")).toBe(mainPanelHost);
    expect(screen.getByTestId("responsive-main-lane")).toBe(persistentLane);

    currentActiveApp = mockProcessApp;
    currentVisitedAppIds = new Set(["projects", "tasks", "process"]);
    view.rerender(
      <MemoryRouter initialEntries={["/process"]}>
        <DesktopShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("main-panel").closest(".mainPanelHost")).toBe(mainPanelHost);
    expect(screen.getByTestId("responsive-main-lane")).toBe(persistentLane);
  });

  it("renders the desktop main panel without a persistent lane wrapper (bareMainPanel)", () => {
    currentActiveApp = { ...mockDesktopApp, bareMainPanel: true } as typeof mockDesktopApp;
    currentVisitedAppIds = new Set(["desktop"]);

    renderShell("/desktop");

    expect(screen.queryByTestId("responsive-main-lane")).toBeNull();
    expect(screen.getByTestId("main-panel")).toBeInTheDocument();
  });

  it("keeps the sidekick lane mounted while swapping app content", () => {
    currentActiveApp = mockAgentsApp;
    currentVisitedAppIds = new Set(["agents"]);
    const view = renderShell("/agents");
    const sidekickLane = screen.getByTestId("sidekick-lane");
    const mainPanelHost = screen.getByTestId("main-panel").closest(".mainPanelHost");

    expect(screen.getByTestId("sidekick-panel")).toHaveAttribute("data-app", "agents");
    expect(mainPanelHost).not.toBeNull();
    expect(mainPanelHost).not.toHaveClass("mainPanelHostNoSidekick");

    currentActiveApp = mockProjectsApp;
    currentVisitedAppIds = new Set(["agents", "projects"]);
    view.rerender(
      <MemoryRouter initialEntries={["/projects"]}>
        <DesktopShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("sidekick-lane")).toBe(sidekickLane);
    expect(screen.getByTestId("sidekick-panel")).toHaveAttribute("data-app", "projects");
    expect(screen.getByTestId("main-panel").closest(".mainPanelHost")).toBe(mainPanelHost);
    expect(mainPanelHost).not.toHaveClass("mainPanelHostNoSidekick");

    currentActiveApp = mockAgentsApp;
    view.rerender(
      <MemoryRouter initialEntries={["/agents"]}>
        <DesktopShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("sidekick-lane")).toBe(sidekickLane);
    expect(screen.getByTestId("sidekick-panel")).toHaveAttribute("data-app", "agents");
    expect(screen.getByTestId("main-panel").closest(".mainPanelHost")).toBe(mainPanelHost);
    expect(mainPanelHost).not.toHaveClass("mainPanelHostNoSidekick");
  });

  it("keeps shared desktop left menu panes mounted across app switches", () => {
    currentActiveApp = mockProjectsApp;
    currentVisitedAppIds = new Set(["projects"]);
    const view = renderShell("/projects");
    const projectsPane = screen.getByTestId("desktop-left-menu-pane-projects");

    currentActiveApp = mockTasksApp;
    currentVisitedAppIds = new Set(["projects", "tasks"]);
    view.rerender(
      <MemoryRouter initialEntries={["/tasks"]}>
        <DesktopShell />
      </MemoryRouter>,
    );
    const persistedProjectsPane = screen.getByTestId("desktop-left-menu-pane-projects");
    const tasksPane = screen.getByTestId("desktop-left-menu-pane-tasks");

    expect(persistedProjectsPane).toBe(projectsPane);
    expect(tasksPane).toBeInTheDocument();

    currentActiveApp = mockProcessApp;
    currentVisitedAppIds = new Set(["projects", "tasks", "process"]);
    view.rerender(
      <MemoryRouter initialEntries={["/process"]}>
        <DesktopShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("desktop-left-menu-pane-projects")).toBe(projectsPane);
    expect(screen.getByTestId("desktop-left-menu-pane-tasks")).toBe(tasksPane);
    expect(screen.getByTestId("desktop-left-menu-pane-process")).toBeInTheDocument();
  });

  it("renders sidebar search input", () => {
    renderShell();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
  });

  it("does not render the old bottom task output panel in the sidekick lane", () => {
    renderShell();
    expect(screen.queryByTestId("task-output-panel")).not.toBeInTheDocument();
  });

  it("does not show host settings button when feature is disabled", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "Open host settings" })).not.toBeInTheDocument();
  });

  it("keeps open agent windows mounted across non-desktop and desktop apps", () => {
    useDesktopWindowStore.setState({
      windows: {
        "agent-1": {
          agentId: "agent-1",
          x: 120,
          y: 84,
          width: 420,
          height: 520,
          zIndex: 3,
          minimized: false,
          maximized: false,
        },
      },
      nextZ: 4,
    });

    currentActiveApp = mockTasksApp;
    const view = renderShell("/tasks");
    const host = screen.getByTestId("agent-window").parentElement;

    expect(screen.getByTestId("agent-window")).toHaveAttribute("data-agent-id", "agent-1");
    expect(screen.getByTestId("agent-window")).toHaveAttribute("data-x", "120");
    expect(screen.getByTestId("agent-window")).toHaveAttribute("data-y", "84");
    expect(host).toHaveClass("windowLayerHost");
    expect(host?.parentElement).toHaveClass("desktopContent");
    expect(host?.closest(".mainPanelHost")).toBeNull();

    currentActiveApp = mockDesktopApp;
    view.rerender(
      <MemoryRouter initialEntries={["/desktop"]}>
        <DesktopShell />
      </MemoryRouter>,
    );
    const rerenderedHost = screen.getByTestId("agent-window").parentElement;

    expect(screen.getByTestId("agent-window")).toHaveAttribute("data-x", "120");
    expect(screen.getByTestId("agent-window")).toHaveAttribute("data-y", "84");
    expect(screen.getByTestId("agent-window")).toHaveAttribute("data-focused", "true");
    expect(rerenderedHost?.parentElement).toHaveClass("desktopContent");
  });

  it("keeps the persistent sidekick lane mounted with no internal storage key", () => {
    currentActiveApp = mockTasksApp;

    renderShell();

    expect(getLatestSidekickLaneProps()?.storageKey).toBeNull();
  });

  it("keeps the same sidekick width across app switches (no retargeting)", () => {
    localStorage.setItem(SIDEKICK_STORAGE_KEY, "420");
    currentActiveApp = mockAgentsApp;
    currentVisitedAppIds = new Set(["agents"]);
    const view = renderShell("/agents");

    const initialWidth = getLatestSidekickLaneProps()?.defaultWidth;
    expect(initialWidth).toBe(420);

    currentActiveApp = mockTasksApp;
    currentVisitedAppIds = new Set(["agents", "tasks"]);
    view.rerender(
      <MemoryRouter initialEntries={["/tasks"]}>
        <DesktopShell />
      </MemoryRouter>,
    );

    currentActiveApp = mockProjectsApp;
    currentVisitedAppIds = new Set(["agents", "tasks", "projects"]);
    view.rerender(
      <MemoryRouter initialEntries={["/projects"]}>
        <DesktopShell />
      </MemoryRouter>,
    );

    const renderedWidths = getAllSidekickLaneProps().map((p) => p.defaultWidth);
    expect(new Set(renderedWidths)).toEqual(new Set([420]));
  });

  it("reads the new shared key when present (regardless of active app)", () => {
    localStorage.setItem(SIDEKICK_STORAGE_KEY, "500");

    currentActiveApp = mockAgentsApp;
    currentVisitedAppIds = new Set(["agents"]);
    renderShell("/agents");
    expect(getLatestSidekickLaneProps()?.defaultWidth).toBe(500);
  });

  it("migrates from the legacy shared key when no shared width is set", () => {
    localStorage.setItem(LEGACY_SHARED_KEY, "440");

    currentActiveApp = mockAgentsApp;
    currentVisitedAppIds = new Set(["agents"]);
    renderShell("/agents");

    expect(getLatestSidekickLaneProps()?.defaultWidth).toBe(440);
    // The migrated value should be written through to the new key so
    // subsequent reads short-circuit.
    expect(localStorage.getItem(SIDEKICK_STORAGE_KEY)).toBe("440");
  });

  it("migrates from the legacy projects key when nothing else is set", () => {
    localStorage.setItem(LEGACY_PROJECTS_KEY, "360");

    currentActiveApp = mockTasksApp;
    currentVisitedAppIds = new Set(["tasks"]);
    renderShell("/tasks");

    expect(getLatestSidekickLaneProps()?.defaultWidth).toBe(360);
    expect(localStorage.getItem(SIDEKICK_STORAGE_KEY)).toBe("360");
  });

  it("inherits the projects per-app width when no shared/legacy width exists", () => {
    localStorage.setItem(legacyPerAppKey("agents"), "260");
    localStorage.setItem(legacyPerAppKey("tasks"), "300");
    localStorage.setItem(legacyPerAppKey("projects"), "555");

    currentActiveApp = mockAgentsApp;
    currentVisitedAppIds = new Set(["agents"]);
    renderShell("/agents");

    expect(getLatestSidekickLaneProps()?.defaultWidth).toBe(555);
    expect(localStorage.getItem(SIDEKICK_STORAGE_KEY)).toBe("555");
  });

  it("falls back to tasks per-app width when projects has none", () => {
    localStorage.setItem(legacyPerAppKey("agents"), "260");
    localStorage.setItem(legacyPerAppKey("tasks"), "388");

    currentActiveApp = mockAgentsApp;
    currentVisitedAppIds = new Set(["agents"]);
    renderShell("/agents");

    expect(getLatestSidekickLaneProps()?.defaultWidth).toBe(388);
    expect(localStorage.getItem(SIDEKICK_STORAGE_KEY)).toBe("388");
  });

  it("persists sidekick resize under the single shared key regardless of active app", () => {
    localStorage.clear();
    currentActiveApp = mockTasksApp;
    currentVisitedAppIds = new Set(["tasks"]);
    renderShell("/tasks");

    const laneProps = getLatestSidekickLaneProps() as
      | { onResizeEnd?: (size: number) => void }
      | undefined;
    expect(laneProps?.onResizeEnd).toBeDefined();
    laneProps!.onResizeEnd!(512);

    expect(localStorage.getItem(SIDEKICK_STORAGE_KEY)).toBe("512");
    // No per-app entries should ever be written.
    expect(localStorage.getItem(legacyPerAppKey("tasks"))).toBeNull();
    expect(localStorage.getItem(legacyPerAppKey("agents"))).toBeNull();
    expect(localStorage.getItem(legacyPerAppKey("projects"))).toBeNull();
  });

  it("disables left sidebar collapse animation in desktop mode", () => {
    currentActiveApp = mockDesktopApp;

    renderShell("/desktop");

    expect(getLatestSidebarLaneProps()).toMatchObject({
      storageKey: "aura-sidebar",
      collapsed: true,
      animateCollapse: false,
    });
  });
});
