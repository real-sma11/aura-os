import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
const openBuyCredits = vi.fn();
const openOrgSettings = vi.fn();
const openAppsModal = vi.fn();
const openInviteModal = vi.fn();
const closeInviteModal = vi.fn();
const openOrFocus = vi.fn();
const closeWindow = vi.fn();
const toggleFavorite = vi.fn();
const registerAgents = vi.fn();
const registerRemoteAgents = vi.fn();
const getTaskbarAppsCollapsed = vi.fn();
const setTaskbarAppsCollapsed = vi.fn();
const getTaskbarRightCollapsed = vi.fn();
const setTaskbarRightCollapsed = vi.fn();

const uiModalState = {
  openBuyCredits,
  openOrgSettings,
  openAppsModal,
  openInviteModal,
  closeInviteModal,
  inviteModalOpen: false,
};

const activeAppState = {
  activeApp: { id: "projects" },
};

const appUIState = {
  previousPath: "/projects",
};

const desktopWindowState = {
  windows: {} as Record<string, unknown>,
  openOrFocus,
  closeWindow,
};

const favoriteAgents = [
  {
    agent_id: "agent-1",
    name: "Desk Helper",
    machine_type: "local",
    icon: null,
  },
];

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("lucide-react", () => ({
  Circle: () => <svg />,
  CreditCard: () => <svg />,
  Settings: () => <svg />,
  ChevronRight: () => <svg data-testid="chevron-right" />,
  ChevronLeft: () => <svg data-testid="chevron-left" />,
  LayoutGrid: () => <svg data-testid="layout-grid" />,
  StarOff: () => <svg />,
  X: () => <svg />,
  HelpCircle: () => <svg />,
  MessageSquare: () => <svg />,
  FolderPlus: () => <svg />,
  Bot: () => <svg />,
  Sparkles: () => <svg />,
  Check: () => <svg />,
  ChevronDown: () => <svg />,
  ChevronUp: () => <svg />,
  Image: () => <svg />,
  Upload: () => <svg />,
  Sun: () => <svg data-testid="theme-icon-sun" />,
  Moon: () => <svg data-testid="theme-icon-moon" />,
  Zap: () => <svg data-testid="icon-zap" />,
}));

interface MockMenuItem {
  id: string;
  label: string;
}

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}{children}</button>
  ),
  Menu: ({
    items,
    onChange,
  }: {
    items: MockMenuItem[];
    onChange?: (id: string) => void;
  }) => (
    <div role="menu" data-testid="zui-menu">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => onChange?.(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  Modal: ({ isOpen, children }: { isOpen: boolean; children?: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
  Heading: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  useTheme: () => ({
    theme: "dark" as const,
    resolvedTheme: "dark" as const,
    setTheme: vi.fn(),
  }),
}));

vi.mock("../../apps/desktop/BackgroundModal", () => ({
  BackgroundModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="background-modal" /> : null,
}));

vi.mock("../InviteModal/InviteModal", () => ({
  InviteModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="invite-modal" /> : null,
}));

vi.mock("../CreditsBadge/useCreditBalance", () => ({
  useCreditBalance: () => ({ credits: 1200 }),
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: (selector: (state: typeof uiModalState) => unknown) => selector(uiModalState),
}));

vi.mock("../../hooks/use-active-app", () => ({
  useActiveApp: () => activeAppState.activeApp,
  useActiveAppId: () => activeAppState.activeApp.id,
}));

vi.mock("../../stores/app-ui-store", () => ({
  useAppUIStore: (selector: (state: typeof appUIState) => unknown) => selector(appUIState),
}));

vi.mock("../../stores/desktop-window-store", () => ({
  useDesktopWindowStore: (
    selector: (state: {
      windows: typeof desktopWindowState.windows;
      openOrFocus: typeof openOrFocus;
      closeWindow: typeof closeWindow;
    }) => unknown,
  ) => selector(desktopWindowState),
  selectIsWindowOpen: (agentId: string) => (state: { windows: typeof desktopWindowState.windows }) =>
    !!state.windows[agentId],
}));

vi.mock("../../utils/storage", () => ({
  getTaskbarAppsCollapsed: () => getTaskbarAppsCollapsed(),
  setTaskbarAppsCollapsed: (collapsed: boolean) => setTaskbarAppsCollapsed(collapsed),
  getTaskbarRightCollapsed: () => getTaskbarRightCollapsed(),
  setTaskbarRightCollapsed: (collapsed: boolean) => setTaskbarRightCollapsed(collapsed),
}));

vi.mock("../ConnectionDot/ConnectionDot", () => ({
  ConnectionDot: () => <span data-testid="connection-dot" />,
}));

vi.mock("../Avatar", () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>,
}));

vi.mock("../AppNavRail", () => ({
  TASKBAR_ICON_SIZE: 16,
  AppNavRail: (props: Record<string, unknown>) => (
    <div
      data-testid="app-nav-rail"
      data-allow-reorder={String(Boolean(props.allowReorder))}
      data-include-ids={JSON.stringify(props.includeIds ?? null)}
    />
  ),
  TaskbarIconButton: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}{children}</button>
  ),
}));

vi.mock("../../apps/agents/stores", () => ({
  useFavoriteAgents: () => favoriteAgents,
  useAgentStore: (selector: (state: { toggleFavorite: typeof toggleFavorite }) => unknown) =>
    selector({ toggleFavorite }),
}));

vi.mock("../../hooks/use-avatar-state", () => ({
  useAvatarState: () => ({ status: "online", isLocal: true }),
}));

vi.mock("../../stores/profile-status-store", () => ({
  useProfileStatusStore: (
    selector: (state: {
      registerAgents: typeof registerAgents;
      registerRemoteAgents: typeof registerRemoteAgents;
    }) => unknown,
  ) => selector({ registerAgents, registerRemoteAgents }),
}));

vi.mock("./BottomTaskbar.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { BottomTaskbar } from "./BottomTaskbar";

beforeEach(() => {
  vi.clearAllMocks();
  activeAppState.activeApp = { id: "projects" };
  appUIState.previousPath = "/projects";
  desktopWindowState.windows = {};
  getTaskbarAppsCollapsed.mockReturnValue(true);
  getTaskbarRightCollapsed.mockReturnValue(true);
});

describe("BottomTaskbar", () => {
  it("opens a favorite agent without navigating to desktop when outside desktop mode", async () => {
    const user = userEvent.setup();

    render(<BottomTaskbar mode="advanced" />);

    await user.click(screen.getByRole("button", { name: "Desk Helper" }));

    expect(openOrFocus).toHaveBeenCalledWith("agent-1");
    expect(closeWindow).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("closes an already-open favorite agent outside desktop mode", async () => {
    const user = userEvent.setup();
    desktopWindowState.windows = {
      "agent-1": { agentId: "agent-1" },
    };

    render(<BottomTaskbar mode="advanced" />);

    await user.click(screen.getByRole("button", { name: "Desk Helper" }));

    expect(closeWindow).toHaveBeenCalledWith("agent-1");
    expect(openOrFocus).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("keeps the same close toggle on desktop", async () => {
    const user = userEvent.setup();
    activeAppState.activeApp = { id: "desktop" };
    desktopWindowState.windows = {
      "agent-1": { agentId: "agent-1" },
    };

    render(<BottomTaskbar mode="advanced" />);

    await user.click(screen.getByRole("button", { name: "Desk Helper" }));

    expect(closeWindow).toHaveBeenCalledWith("agent-1");
    expect(openOrFocus).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders the taskbar apps collapsed by default", () => {
    render(<BottomTaskbar mode="advanced" />);

    expect(screen.getByRole("button", { name: "Expand apps" })).toBeInTheDocument();
    expect(screen.getAllByTestId("chevron-right").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Expand taskbar" })).toBeInTheDocument();

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute(
      "data-include-ids",
      JSON.stringify(["agents", "projects"]),
    );
    expect(leftNavRail).toHaveAttribute("data-allow-reorder", "true");
    expect(navRails[1]).toHaveAttribute("data-allow-reorder", "false");
  });

  it("restores the expanded state from storage", () => {
    getTaskbarAppsCollapsed.mockReturnValue(false);

    render(<BottomTaskbar mode="advanced" />);

    expect(screen.getByRole("button", { name: "Collapse apps" })).toBeInTheDocument();

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute("data-include-ids", "null");
  });

  it("hides everything except profile when the right cluster is collapsed by default", () => {
    render(<BottomTaskbar mode="advanced" />);

    expect(screen.getByRole("button", { name: "Expand taskbar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Credits" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();

    const profileNavRail = screen.getAllByTestId("app-nav-rail").find((rail) =>
      rail.getAttribute("data-include-ids") === JSON.stringify(["profile"]),
    );
    expect(profileNavRail).toBeDefined();
  });

  it("expands the right cluster and persists the state when the chevron is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar mode="advanced" />);

    await user.click(screen.getByRole("button", { name: "Expand taskbar" }));

    expect(screen.getByRole("button", { name: "Collapse taskbar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credits" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(setTaskbarRightCollapsed).toHaveBeenCalledWith(false);
  });

  it("re-collapses the right cluster on a second chevron click", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar mode="advanced" />);

    await user.click(screen.getByRole("button", { name: "Expand taskbar" }));
    await user.click(screen.getByRole("button", { name: "Collapse taskbar" }));

    expect(screen.getByRole("button", { name: "Expand taskbar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Credits" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(setTaskbarRightCollapsed).toHaveBeenNthCalledWith(1, false);
    expect(setTaskbarRightCollapsed).toHaveBeenNthCalledWith(2, true);
  });

  it("restores the expanded right cluster state from storage", () => {
    getTaskbarRightCollapsed.mockReturnValue(false);

    render(<BottomTaskbar mode="advanced" />);

    expect(screen.getByRole("button", { name: "Collapse taskbar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credits" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("opens settings from the taskbar shortcut", async () => {
    const user = userEvent.setup();
    getTaskbarRightCollapsed.mockReturnValue(false);

    render(<BottomTaskbar mode="advanced" />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(openOrgSettings).toHaveBeenCalledTimes(1);
  });

  it("expands to all apps when the chevron is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar mode="advanced" />);

    await user.click(screen.getByRole("button", { name: "Expand apps" }));

    expect(screen.getByRole("button", { name: "Collapse apps" })).toBeInTheDocument();
    expect(setTaskbarAppsCollapsed).toHaveBeenCalledWith(false);

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute("data-include-ids", "null");
  });

  it("collapses back to agents and projects on a second chevron click", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar mode="advanced" />);

    const chevron = screen.getByRole("button", { name: "Expand apps" });
    await user.click(chevron);
    await user.click(screen.getByRole("button", { name: "Collapse apps" }));

    expect(screen.getByRole("button", { name: "Expand apps" })).toBeInTheDocument();
    expect(setTaskbarAppsCollapsed).toHaveBeenNthCalledWith(1, false);
    expect(setTaskbarAppsCollapsed).toHaveBeenNthCalledWith(2, true);

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute(
      "data-include-ids",
      JSON.stringify(["agents", "projects"]),
    );
  });

  describe("right-click context menu", () => {
    function getBar(container: HTMLElement) {
      const bar = container.querySelector<HTMLElement>(
        '[data-agent-surface="desktop-shell-bottom-taskbar"]',
      );
      if (!bar) throw new Error("Bottom taskbar root not found");
      return bar;
    }

    it("opens the desktop context menu when right-clicking empty taskbar space", () => {
      const { container } = render(<BottomTaskbar mode="advanced" />);

      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();

      fireEvent.contextMenu(getBar(container));

      expect(screen.getByTestId("zui-menu")).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Background" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    });

    it("does not open the desktop context menu when right-clicking a taskbar button", () => {
      render(<BottomTaskbar mode="advanced" />);

      fireEvent.contextMenu(screen.getByRole("button", { name: "Apps" }));

      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();
    });

    it("opens org settings when selecting Settings from the context menu", async () => {
      const user = userEvent.setup();
      const { container } = render(<BottomTaskbar mode="advanced" />);

      fireEvent.contextMenu(getBar(container));
      await user.click(screen.getByRole("menuitem", { name: "Settings" }));

      expect(openOrgSettings).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();
    });

    it("opens the background modal when selecting Background", async () => {
      const user = userEvent.setup();
      const { container } = render(<BottomTaskbar mode="advanced" />);

      fireEvent.contextMenu(getBar(container));
      await user.click(screen.getByRole("menuitem", { name: "Background" }));

      expect(screen.getByTestId("background-modal")).toBeInTheDocument();
    });

    it("preserves outer .bar DOM identity across the Simple <-> Advanced flip", () => {
      // The outer `.bar` element must reconcile in place across
      // mode flips so `--shell-chrome-outer-height` keeps reserving
      // the same row of vertical space (Phase 3 invariant). Both
      // Simple and Advanced go through `AuthedBottomTaskbar`, whose
      // outer `<div className={styles.bar}>` is unconditional —
      // React reuses the same DOM node when only inner slots swap.
      const { container, rerender } = render(<BottomTaskbar mode="advanced" />);
      const barBefore = container.querySelector(
        '[data-agent-surface="desktop-shell-bottom-taskbar"]',
      );
      expect(barBefore).not.toBeNull();
      expect(barBefore).toHaveAttribute("data-ui-mode", "advanced");

      rerender(<BottomTaskbar mode="simple" />);
      const barAfter = container.querySelector(
        '[data-agent-surface="desktop-shell-bottom-taskbar"]',
      );
      expect(barAfter).toBe(barBefore);
      expect(barAfter).toHaveAttribute("data-ui-mode", "simple");

      rerender(<BottomTaskbar mode="advanced" />);
      const barRoundtrip = container.querySelector(
        '[data-agent-surface="desktop-shell-bottom-taskbar"]',
      );
      expect(barRoundtrip).toBe(barBefore);
      expect(barRoundtrip).toHaveAttribute("data-ui-mode", "advanced");
    });

    it("anchors to the bottom of the click when right-clicking near the viewport bottom", () => {
      const originalInnerHeight = window.innerHeight;
      const originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, "innerHeight", {
        value: 800,
        configurable: true,
      });
      Object.defineProperty(window, "innerWidth", {
        value: 1280,
        configurable: true,
      });

      try {
        const { container } = render(<BottomTaskbar mode="advanced" />);

        fireEvent.contextMenu(getBar(container), {
          clientX: 200,
          clientY: 790,
        });

        const overlay = screen.getByTestId("zui-menu").parentElement as HTMLElement;
        expect(overlay.style.bottom).not.toBe("");
        expect(overlay.style.top).toBe("");
      } finally {
        Object.defineProperty(window, "innerHeight", {
          value: originalInnerHeight,
          configurable: true,
        });
        Object.defineProperty(window, "innerWidth", {
          value: originalInnerWidth,
          configurable: true,
        });
      }
    });
  });

  describe("Simple vs Advanced visible difference", () => {
    it("hides Desktop, favorites, app rail, both collapse chevrons, Help, the clock, and the .left/.center pills entirely in Simple mode", () => {
      // Even with a non-default stored collapse state (`false` would
      // expose the right-cluster contents in Advanced), Simple mode
      // never surfaces the chevron — it has no collapse affordance.
      getTaskbarRightCollapsed.mockReturnValue(false);
      getTaskbarAppsCollapsed.mockReturnValue(false);

      const { container } = render(<BottomTaskbar mode="simple" />);

      // Left slot — Desktop button + favorite agents are Advanced-only,
      // and the `.left` pill itself doesn't mount in Simple so the row
      // doesn't carry an empty rounded chrome pill on the left edge.
      expect(
        screen.queryByRole("button", { name: "Desktop" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Desk Helper" }),
      ).not.toBeInTheDocument();
      expect(container.querySelector(".left")).toBeNull();

      // Center slot — AppNavRail + Apps + apps-collapse chevron are
      // Advanced-only, and the `.center` pill itself unmounts in
      // Simple too (the empty rounded pill that previously floated in
      // the middle of the row is gone).
      expect(
        screen.queryByRole("button", { name: "Apps" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /expand apps/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /collapse apps/i }),
      ).not.toBeInTheDocument();
      expect(container.querySelector(".center")).toBeNull();

      // Right slot — the right-cluster collapse chevron and Help
      // button are Advanced-only.
      expect(
        screen.queryByRole("button", { name: /expand taskbar/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /collapse taskbar/i }),
      ).not.toBeInTheDocument();

      // No clock readout in Simple — the `<ClockReadout />` extraction
      // skips `useClock`'s setInterval entirely. The proxy CSS-module
      // mock turns `styles.clock` into the literal class `clock`.
      expect(container.querySelector(".clock")).toBeNull();
    });

    it("renders Credits, Settings, and the theme toggle in Simple mode (no profile rail, no collapse)", () => {
      // Stored right-cluster collapse state is true (Advanced default)
      // but Simple ignores it — Credits/Settings/Theme always show.
      getTaskbarRightCollapsed.mockReturnValue(true);

      render(<BottomTaskbar mode="simple" />);

      expect(screen.getByRole("button", { name: "Credits" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
      // ThemeToggleButton's aria-label is generated by
      // `getThemeToggleAriaLabel`: "Switch theme (currently <theme>)".
      expect(
        screen.getByRole("button", { name: /switch theme/i }),
      ).toBeInTheDocument();

      // Simple drops every AppNavRail — the center rail is Advanced-
      // only and the bottom-right profile rail is now gated on
      // `isAdvanced` too, so the right cluster reads as Credits /
      // Settings / Theme only.
      expect(screen.queryAllByTestId("app-nav-rail")).toHaveLength(0);
    });

    it("flipping mode='advanced' -> mode='simple' removes Desktop / Apps / clock / .left / .center / profile rail without remounting .bar", () => {
      // Reference-equality across Simple <-> Advanced is asserted in
      // the "preserves outer .bar DOM identity" test in the
      // right-click describe block; this case covers the *visible*
      // differential — what disappears between Advanced and Simple
      // inside the same outer container.
      getTaskbarRightCollapsed.mockReturnValue(false);
      const { container, rerender } = render(<BottomTaskbar mode="advanced" />);

      expect(screen.getByRole("button", { name: "Desktop" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apps" })).toBeInTheDocument();
      expect(container.querySelector(".clock")).not.toBeNull();
      expect(container.querySelector(".left")).not.toBeNull();
      expect(container.querySelector(".center")).not.toBeNull();
      expect(screen.getAllByTestId("app-nav-rail")).toHaveLength(2);

      rerender(<BottomTaskbar mode="simple" />);

      expect(
        screen.queryByRole("button", { name: "Desktop" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Apps" }),
      ).not.toBeInTheDocument();
      expect(container.querySelector(".clock")).toBeNull();
      expect(container.querySelector(".left")).toBeNull();
      expect(container.querySelector(".center")).toBeNull();
      expect(screen.queryAllByTestId("app-nav-rail")).toHaveLength(0);
    });
  });

  describe("Public mode", () => {
    it("renders the theme toggle in the left slot and `data-ui-mode='public'` on the bar", () => {
      const { container } = render(<BottomTaskbar mode="public" />);

      const bar = container.querySelector(
        '[data-agent-surface="desktop-shell-bottom-taskbar"]',
      );
      expect(bar).not.toBeNull();
      expect(bar).toHaveAttribute("data-ui-mode", "public");

      // Theme toggle moved to the left slot in public mode (paired
      // with the 'Powered by THE GRID' link on the right). Credits,
      // Settings, Apps, Desktop, the profile rail, and the clock are
      // all gated behind `AuthedBottomTaskbar` which doesn't mount.
      const themeToggle = screen.getByRole("button", { name: /switch theme/i });
      expect(themeToggle).toBeInTheDocument();
      const leftSlot = container.querySelector(".left");
      expect(leftSlot).not.toBeNull();
      expect(leftSlot).toContainElement(themeToggle);

      expect(
        screen.queryByRole("button", { name: "Credits" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Settings" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Apps" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Desktop" }),
      ).not.toBeInTheDocument();
      expect(screen.queryAllByTestId("app-nav-rail")).toHaveLength(0);
      expect(container.querySelector(".clock")).toBeNull();
    });

    it("renders a 'Powered by THE GRID' link to the GitHub repo opening in a new tab", () => {
      render(<BottomTaskbar mode="public" />);

      const link = screen.getByRole("link", { name: /powered by the grid/i });
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/cypher-asi/the-grid",
      );
      expect(link).toHaveAttribute("target", "_blank");
      const rel = link.getAttribute("rel") ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
    });

    it("does not render the 'Powered by THE GRID' link in authed modes", () => {
      const { rerender } = render(<BottomTaskbar mode="simple" />);
      expect(
        screen.queryByRole("link", { name: /powered by the grid/i }),
      ).not.toBeInTheDocument();

      rerender(<BottomTaskbar mode="advanced" />);
      expect(
        screen.queryByRole("link", { name: /powered by the grid/i }),
      ).not.toBeInTheDocument();
    });
  });
});
