/**
 * AuraShell — Phase 3 regression suite.
 *
 * Covers the load-bearing invariants of the unified shell:
 *
 *   (a) **Stable mounts across mode flips.** Captures DOM refs to the
 *       titlebar wrapper, sidebar Lane, sidebar header, main panel,
 *       and BottomTaskbar `.bar` BEFORE a mode change; flips
 *       `useUIModeStore.setState({ mode: ... })`; re-captures the
 *       same `data-testid`s; asserts each pair is reference-equal.
 *       The slide-not-snap animation, search query continuity, and
 *       `--shell-chrome-outer-height` row stability all depend on
 *       these elements never remounting.
 *
 *   (b) **BottomTaskbar in public mode** renders only
 *       `ThemeToggleButton` (no Desktop / favorites / app rail /
 *       credits / settings / help / profile) and keeps the outer
 *       `.bar` `data-ui-mode="public"`. The outer `.bar` is what
 *       reserves the `--shell-chrome-outer-height` row, so its
 *       presence in every mode is what keeps the main panel's
 *       bottom edge from shifting on flip.
 *
 *   (c) **Sidebar search continuity.** Types "hello" into the
 *       `<PanelSearch>` input, flips Simple <-> Advanced via the
 *       store, asserts the input value is still "hello". Backed by
 *       the per-app `useAppUIStore.sidebarQueries` map (for authed)
 *       and the `useSidebarSearchStore` (for public).
 *
 *   (d) **Public-only content gate.** In public effective mode the
 *       public nav footer (Pricing link) and `MockAuraApp` hero are
 *       in the DOM. After `useAuthStore.setState({ user: ... })`
 *       (auth simulated), the same queries return null — the
 *       public-only surface is gone.
 *
 * `data-testid` contract:
 *   - `aura-shell`          — root `.shell` div
 *   - `aura-titlebar`       — `<ShellTitlebar>` outer wrapper
 *   - `aura-sidebar`        — sidebar `<aside>`
 *   - `aura-sidebar-header` — `.sidebarHeader` div
 *   - `aura-shell-main`     — `<main>` slot
 *   - `ui-mode-indicator`   — `SlidingPills` indicator span
 *
 * Test setup uses `MemoryRouter` to drive the route tree (so
 * `useLocation` / `useOutlet` work) and stubs the few heavy modules
 * that don't matter for shell composition (zui Topbar / Input, the
 * theme/wallpaper background layer).
 */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useUIModeStore } from "../../stores/ui-mode-store";
import { useAuthStore } from "../../stores/auth-store";
import { useSidebarSearchStore } from "../../stores/sidebar-search-store";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { __setIsMacForTesting } from "../../lib/platform";
import { PUBLIC_SIDEBAR_COLLAPSED_KEY } from "../../constants";

vi.mock("@cypher-asi/zui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@cypher-asi/zui");
  return {
    ...actual,
    Topbar: ({
      icon,
      title,
      actions,
      ...rest
    }: {
      icon?: React.ReactNode;
      title?: React.ReactNode;
      actions?: React.ReactNode;
    } & Record<string, unknown>) => (
      // Spreading `rest` keeps the production `onDoubleClick`
      // (which dispatches `windowCommand("maximize")`) attached to
      // the stub root so propagation tests for in-titlebar buttons
      // can assert real bubbling behaviour.
      <div
        data-testid={(rest["data-testid"] as string) ?? "zui-topbar-stub"}
        {...(rest as Record<string, unknown>)}
      >
        <div>{icon}</div>
        <div>{title}</div>
        <div>{actions}</div>
      </div>
    ),
    Input: ({
      placeholder,
      value,
      onChange,
      className,
      ...rest
    }: {
      placeholder?: string;
      value?: string;
      onChange?: (event: { target: { value: string } }) => void;
      className?: string;
      size?: string;
    } & Record<string, unknown>) => (
      <input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={className}
        {...(rest as Record<string, unknown>)}
      />
    ),
    useTheme: () => ({
      theme: "dark",
      resolvedTheme: "dark",
      setTheme: vi.fn(),
    }),
  };
});

vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

vi.mock("../DesktopShell/BackgroundLayer", () => ({
  BackgroundLayer: () => <div data-testid="background-layer-stub" />,
}));

// HostSettingsModal and the agents window layer are lazy-imported by
// AuraShell. They never render in these tests (no `hostSettingsOpen`
// flag, no open desktop windows) so a no-op stub is sufficient and
// avoids dragging the full module graph in.
vi.mock("../HostSettingsModal", () => ({
  HostSettingsModal: () => null,
}));
vi.mock("../../apps/agents/components/AgentWindow", () => ({
  DesktopWindowLayer: () => null,
}));

import { AuraShell } from "./AuraShell";

const TEST_USER = {
  user_id: "test-user",
  network_user_id: "test-net",
  profile_id: "test-prof",
  display_name: "Test",
  profile_image: null,
  primary_zid: null,
  zero_wallet: null,
  wallets: [],
  is_zero_pro: false,
  is_access_granted: true,
} as unknown as NonNullable<ReturnType<typeof useAuthStore.getState>["user"]>;

function renderAuraShell(initialPath = "/"): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AuraShell />}>
          <Route
            path="/"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/login"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/chat"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/projects/:id"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/desktop"
            element={<div data-testid="outlet-child">child route</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function setLoggedIn(): void {
  useAuthStore.setState({ user: TEST_USER });
}

function setLoggedOut(): void {
  useAuthStore.setState({ user: null });
}

beforeEach(() => {
  window.localStorage.clear();
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: null,
  });
  useSidebarSearchStore.setState({ queries: {} });
  useUIModeStore.setState({ mode: "simple" });
  // Reset the public-sidebar collapse state (its default is `true`,
  // but a previous test may have toggled it open via store action).
  useAppUIStore.setState({ publicSidebarCollapsed: true });
  // Reset any modal state a previous test may have flipped open (the
  // Simple-mode shortcut test below flips `orgSettingsOpen`).
  useUIModalStore.setState({ orgSettingsOpen: false });
  // Pin the platform to non-mac so `Ctrl+...` shortcuts match
  // regardless of the host running the suite.
  __setIsMacForTesting(false);
});

afterEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ user: null });
  __setIsMacForTesting(null);
});

describe("AuraShell — Phase 3 unified shell", () => {
  it("(a) preserves DOM identity of titlebar, sidebar Lane, sidebar header, main, and BottomTaskbar `.bar` across mode flips", async () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    const { container } = renderAuraShell();

    const titlebarBefore = screen.getByTestId("aura-titlebar");
    const sidebarBefore = screen.getByTestId("aura-sidebar");
    const sidebarHeaderBefore = screen.getByTestId("aura-sidebar-header");
    const mainBefore = screen.getByTestId("aura-shell-main");
    const barBefore = container.querySelector(
      "[data-agent-surface='desktop-shell-bottom-taskbar']",
    );
    expect(barBefore).not.toBeNull();

    await act(async () => {
      useUIModeStore.setState({ mode: "advanced" });
    });

    expect(screen.getByTestId("aura-titlebar")).toBe(titlebarBefore);
    expect(screen.getByTestId("aura-sidebar")).toBe(sidebarBefore);
    expect(screen.getByTestId("aura-sidebar-header")).toBe(sidebarHeaderBefore);
    expect(screen.getByTestId("aura-shell-main")).toBe(mainBefore);
    const barAfter = container.querySelector(
      "[data-agent-surface='desktop-shell-bottom-taskbar']",
    );
    expect(barAfter).toBe(barBefore);
  });

  it("(a, cont.) preserves DOM identity across the public -> simple (login) transition", async () => {
    setLoggedOut();
    useUIModeStore.setState({ mode: "simple" });

    renderAuraShell();

    const titlebarBefore = screen.getByTestId("aura-titlebar");
    const sidebarBefore = screen.getByTestId("aura-sidebar");
    const sidebarHeaderBefore = screen.getByTestId("aura-sidebar-header");
    const mainBefore = screen.getByTestId("aura-shell-main");

    await act(async () => {
      setLoggedIn();
    });

    expect(screen.getByTestId("aura-titlebar")).toBe(titlebarBefore);
    expect(screen.getByTestId("aura-sidebar")).toBe(sidebarBefore);
    expect(screen.getByTestId("aura-sidebar-header")).toBe(sidebarHeaderBefore);
    expect(screen.getByTestId("aura-shell-main")).toBe(mainBefore);
  });

  it("(b) BottomTaskbar renders the public minimal cluster in public mode and `.bar` carries data-ui-mode='public'", () => {
    setLoggedOut();

    const { container } = renderAuraShell();

    const bar = container.querySelector(
      "[data-agent-surface='desktop-shell-bottom-taskbar']",
    );
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("data-ui-mode", "public");
    // The full taskbar exposes Apps + Settings + Credits buttons. Each
    // is gated by an authed-only hook chain and must be absent in
    // public mode.
    expect(
      screen.queryByRole("button", { name: /apps/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /settings/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /credits/i }),
    ).not.toBeInTheDocument();
  });

  it("(c) sidebar search query survives a Simple -> Advanced flip (no remount, no input value loss)", async () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    const user = userEvent.setup();
    // Render at `/chat` so path-based resolution returns the same
    // ChatApp the simple-mode pin returns. The per-app
    // `useAppUIStore.sidebarQueries` map is keyed by active app id;
    // mismatched ids across the flip would wipe the input value
    // and shadow the slide-not-snap continuity check.
    renderAuraShell("/chat");

    const input = screen.getByPlaceholderText("Search") as HTMLInputElement;
    await user.type(input, "hello");
    expect(input.value).toBe("hello");

    await act(async () => {
      useUIModeStore.setState({ mode: "advanced" });
    });

    const inputAfter = screen.getByPlaceholderText("Search") as HTMLInputElement;
    expect(inputAfter).toBe(input);
    expect(inputAfter.value).toBe("hello");
  });

  it("(d) gates public nav footer links behind public mode and hides them when logged in", async () => {
    setLoggedOut();

    renderAuraShell();

    // `PublicSidebarFooter` exposes public-only links. They must be
    // present for unauthenticated visitors and absent the moment the
    // user signs in.
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute(
      "href",
      "/chat",
    );

    await act(async () => {
      setLoggedIn();
      useUIModeStore.setState({ mode: "simple" });
    });

    expect(
      screen.queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
  });

  it("(e) hides the Simple/Advanced ModeToggle in public mode and remounts it on sign-in", async () => {
    // The toggle never makes sense for unauthenticated visitors —
    // they have no persisted authed mode to flip. AuraSidebar gates
    // the render behind `mode !== "public"` so the radiogroup is
    // absent until the user logs in.
    setLoggedOut();

    renderAuraShell();

    expect(
      screen.queryByRole("radiogroup", { name: "Interface mode" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      setLoggedIn();
      useUIModeStore.setState({ mode: "simple" });
    });

    expect(
      screen.getByRole("radiogroup", { name: "Interface mode" }),
    ).toBeInTheDocument();
  });

  it("(f) public titlebar does not render a theme toggle (day/night lives in BottomTaskbar) but keeps the auth pills", () => {
    setLoggedOut();

    renderAuraShell();

    const titlebar = screen.getByTestId("aura-titlebar");
    // No sun/moon button anywhere inside the titlebar — the public
    // chrome's only day/night affordance lives in the BottomTaskbar
    // right cluster. `getThemeToggleAriaLabel` formats as
    // "Switch theme (currently <theme>)", so a `/switch theme/i`
    // role query catches it regardless of the resolved theme.
    expect(
      within(titlebar).queryByRole("button", { name: /switch theme/i }),
    ).not.toBeInTheDocument();

    // The Log In / Sign Up pills are the load-bearing public-mode
    // CTAs and must remain in the trailing slot.
    expect(
      within(titlebar).getByRole("link", { name: "Log In" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("link", { name: "Sign Up" }),
    ).toBeInTheDocument();
  });

  it("(g) suppresses the desktop wallpaper (BackgroundLayer) in public and Simple modes and mounts it only in Advanced", async () => {
    // The persisted desktop wallpaper must not bleed onto logged-out
    // surfaces, and Simple mode is a chat-only surface that also
    // suppresses the wallpaper. AuraShell gates `<BackgroundLayer />`
    // behind `mode === "advanced"`, so the stub testid is absent in
    // public + Simple and appears only when the user lands in
    // Advanced.
    setLoggedOut();

    renderAuraShell();

    expect(
      screen.queryByTestId("background-layer-stub"),
    ).not.toBeInTheDocument();

    await act(async () => {
      setLoggedIn();
      useUIModeStore.setState({ mode: "simple" });
    });

    expect(
      screen.queryByTestId("background-layer-stub"),
    ).not.toBeInTheDocument();

    await act(async () => {
      useUIModeStore.setState({ mode: "advanced" });
    });

    expect(screen.getByTestId("background-layer-stub")).toBeInTheDocument();

    await act(async () => {
      useUIModeStore.setState({ mode: "simple" });
    });

    expect(
      screen.queryByTestId("background-layer-stub"),
    ).not.toBeInTheDocument();
  });

  // Note: the `/login` overlay mount lives in `App.tsx` (above the
  // background-location-aware `<Routes>` so `useLocation()` can read
  // the real `/login` URL). Coverage for the overlay UI itself is in
  // `LoginOverlay.test.tsx`; AuraShell no longer owns the gating.
});

/**
 * Simple-mode chrome stripping. Simple is a chat-only surface, so
 * the desktop wallpaper, the right sidekick lane, and the two
 * sidekick-related icon buttons (`Toggle split screen` /
 * `Toggle sidekick`) all unmount. The window controls
 * (min/max/close) stay. The referral CTA (`EarnCreditsButton`)
 * now lives in the left sidebar footer instead of the titlebar
 * trailing cluster — covered by the sidebar assertion below.
 *
 * Coverage for the wallpaper itself is in test (g) above; this
 * block focuses on the right lane + the titlebar trailing cluster.
 */
describe("AuraShell — Simple-mode chrome stripping", () => {
  it("does not mount the right sidekick lane (no `data-agent-surface=\"sidekick-panel\"`) in Simple, and remounts it in Advanced", async () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    const { container } = renderAuraShell("/chat");

    expect(
      container.querySelector('[data-agent-surface="sidekick-panel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-agent-surface="sidekick-header"]'),
    ).toBeNull();

    await act(async () => {
      useUIModeStore.setState({ mode: "advanced" });
    });

    expect(
      container.querySelector('[data-agent-surface="sidekick-panel"]'),
    ).not.toBeNull();
  });

  it("does not render the Split-screen / Sidekick toggle icon buttons in the titlebar in Simple mode, and renders EarnCredits in the sidebar footer", () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    renderAuraShell("/chat");

    const titlebar = screen.getByTestId("aura-titlebar");
    expect(
      within(titlebar).queryByRole("button", { name: /toggle sidekick/i }),
    ).not.toBeInTheDocument();
    expect(
      within(titlebar).queryByRole("button", { name: /toggle split screen/i }),
    ).not.toBeInTheDocument();
    // The referral CTA moved out of the titlebar trailing cluster and
    // into the left sidebar footer (`AuthedSidebarFooter`). Assert it
    // is *not* in the titlebar anymore and *is* in the sidebar — keyed
    // off the new aria-label "Refer a member to earn credits".
    expect(
      within(titlebar).queryByRole("button", { name: /refer a member/i }),
    ).not.toBeInTheDocument();
    const sidebar = screen.getByTestId("aura-sidebar");
    expect(
      within(sidebar).getByRole("button", { name: /refer a member/i }),
    ).toBeInTheDocument();
  });

  it("renders the Split-screen / Sidekick toggle icon buttons in the titlebar in Advanced mode", async () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "advanced" });

    renderAuraShell("/chat");

    const titlebar = screen.getByTestId("aura-titlebar");
    expect(
      within(titlebar).getByRole("button", { name: /toggle sidekick/i }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("button", { name: /toggle split screen/i }),
    ).toBeInTheDocument();
  });

  it("hides the File / Edit / View / Help menu bar in Simple mode and remounts it in Advanced", async () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    renderAuraShell("/chat");

    const titlebar = screen.getByTestId("aura-titlebar");
    expect(
      within(titlebar).queryByRole("menubar", { name: /application menu/i }),
    ).not.toBeInTheDocument();
    expect(
      within(titlebar).queryByRole("menuitem", { name: "File" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      useUIModeStore.setState({ mode: "advanced" });
    });

    expect(
      within(titlebar).getByRole("menubar", { name: /application menu/i }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("menuitem", { name: "File" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("menuitem", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("menuitem", { name: "View" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("menuitem", { name: "Help" }),
    ).toBeInTheDocument();
  });

  it("keeps the application-menu keyboard shortcuts wired in Simple mode (no visible bar required)", () => {
    // The visible bar is gone in Simple, but the headless
    // `<MenuShortcuts />` companion still installs the document-level
    // `keydown` listener. Firing `Ctrl+,` (Settings) must still flip
    // `useUIModalStore.orgSettingsOpen` to `true` — proving the
    // shortcut path survives the chrome stripping.
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    renderAuraShell("/chat");

    expect(useUIModalStore.getState().orgSettingsOpen).toBe(false);

    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: ",",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
    });

    expect(useUIModalStore.getState().orgSettingsOpen).toBe(true);
  });
});

/**
 * Phase 4 `p4_simple_pin_chat` regression coverage.
 *
 * The shell's authoritative source of the "current app" is
 * `useActiveApp()`. Phase 4 pins it to ChatApp whenever the
 * effective mode is `simple`, regardless of the pathname. AuraSidebar
 * stamps `data-agent-active-app-id` on the LeftPanel host, so we
 * assert against that attribute as a structural proxy for "ChatApp's
 * MainPanel + LeftPanel are the things that render right now".
 */
describe("AuraShell — Phase 4 simple-mode pin", () => {
  /**
   * Resolves the currently active app id by inspecting the sidebar
   * subtree. Two probes are needed because the sidebar renders one
   * of two structures:
   *
   *   1. Apps in `sharedDesktopLeftMenuPanes` (e.g. `projects`,
   *      `tasks`) render via `<LeftMenu>`, which stamps
   *      `data-active="true"` on the active pane and exposes its app
   *      id via `data-testid="desktop-left-menu-pane-<id>"`.
   *
   *   2. Apps without a `DesktopLeftMenuPane` (e.g. `chat`) render
   *      their own LeftPanel inside `AuthedSidebarBody`, which stamps
   *      `data-agent-active-app-id` directly on the host div.
   */
  function getActiveAppId(container: HTMLElement): string | null {
    const directHost = container.querySelector("[data-agent-active-app-id]");
    if (directHost) {
      return directHost.getAttribute("data-agent-active-app-id");
    }
    const sharedActivePane = container.querySelector(
      "[data-testid='desktop-left-menu'] [data-active='true']",
    );
    const testId = sharedActivePane?.getAttribute("data-testid");
    if (testId?.startsWith("desktop-left-menu-pane-")) {
      return testId.slice("desktop-left-menu-pane-".length);
    }
    return null;
  }

  it("pins ChatApp as the active app in Simple mode regardless of the URL", async () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    // Render at a non-`/chat` path that maps to a different app
    // (`/projects/:id` -> `projects`). The pin must still resolve
    // ChatApp because effective mode is `simple`.
    const { container } = renderAuraShell("/projects/abc");

    expect(getActiveAppId(container)).toBe("chat");
  });

  it("falls back to path-based resolution in Advanced mode (no pin)", () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "advanced" });

    const { container } = renderAuraShell("/projects/abc");

    expect(getActiveAppId(container)).toBe("projects");
  });

  it("flipping Simple -> Advanced at /projects/abc swaps the active app from chat to projects without remounting the sidebar", async () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    const { container } = renderAuraShell("/projects/abc");
    const sidebarBefore = screen.getByTestId("aura-sidebar");
    expect(getActiveAppId(container)).toBe("chat");

    await act(async () => {
      useUIModeStore.setState({ mode: "advanced" });
    });

    expect(screen.getByTestId("aura-sidebar")).toBe(sidebarBefore);
    expect(getActiveAppId(container)).toBe("projects");
  });

  it("public mode still renders the public chat surface (PublicSidebarFooter pricing link present)", () => {
    setLoggedOut();
    renderAuraShell("/");

    // `PublicSidebarFooter` is the public-only nav footer. In public mode it must mount
    // alongside the public sidebar body — its absence would mean
    // the shell mistakenly resolved to an authed surface.
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument();
  });

  it("sign-in transition (public -> simple) tears down the public footer and mounts ChatAppLeftPanel", async () => {
    setLoggedOut();
    const { container } = renderAuraShell("/");

    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument();
    expect(getActiveAppId(container)).toBeNull();

    await act(async () => {
      setLoggedIn();
      useUIModeStore.setState({ mode: "simple" });
    });

    expect(
      screen.queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
    expect(getActiveAppId(container)).toBe("chat");
  });
});

/**
 * Public-mode left drawer toggle. Mirrors the right-side sidekick
 * drawer (`PanelRight` in `WindowControls.tsx`) on the left so a
 * logged-out visitor sees a ChatGPT-style collapsed sessions panel
 * by default and can flip it open via a single titlebar button. The
 * public nav footer (Product / Changelog / Feedback / Pricing /
 * Chat) lives outside the collapsing Lane so it stays visible in
 * both states.
 *
 * `aria-pressed` mirrors the sidekick toggle's contract (true when
 * the drawer is open, false when collapsed) so AT users get a
 * symmetric experience on both sides of the window chrome.
 */
describe("AuraShell — public left drawer", () => {
  it("renders the left drawer toggle in public mode and starts collapsed (aria-pressed=false), with the public nav footer still visible", () => {
    setLoggedOut();
    renderAuraShell("/");

    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    const sidebar = screen.getByTestId("aura-sidebar");
    expect(sidebar).toHaveAttribute("data-public-sidebar-collapsed", "true");

    // The public nav footer must remain in the DOM at the bottom-left
    // even when the sessions panel above it is collapsed.
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Changelog" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Feedback" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument();
  });

  it("clicking the drawer toggle flips aria-pressed and the sidebar collapse data attribute, then collapses again on a second click", async () => {
    setLoggedOut();
    const user = userEvent.setup();
    renderAuraShell("/");

    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = screen.getByTestId("aura-sidebar");

    await user.click(toggle);

    // After opening: same DOM node (no remount), aria-pressed flips,
    // and the data attribute on the aside reflects the open state.
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(sidebar).toHaveAttribute("data-public-sidebar-collapsed", "false");
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(sidebar).toHaveAttribute("data-public-sidebar-collapsed", "true");
  });

  it("persists the drawer's open state to localStorage so the choice survives a reload", async () => {
    setLoggedOut();
    const user = userEvent.setup();
    renderAuraShell("/");

    expect(window.localStorage.getItem(PUBLIC_SIDEBAR_COLLAPSED_KEY)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(window.localStorage.getItem(PUBLIC_SIDEBAR_COLLAPSED_KEY)).toBe(
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(window.localStorage.getItem(PUBLIC_SIDEBAR_COLLAPSED_KEY)).toBe(
      "true",
    );
  });

  it("does not render the public left drawer toggle in authed modes (no double-affordance with the right sidekick)", () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });
    renderAuraShell("/chat");

    expect(
      screen.queryByRole("button", { name: "Toggle sidebar" }),
    ).not.toBeInTheDocument();
  });

  it("the left drawer toggle's aria-pressed contract matches the right sidekick toggle (open=true, collapsed=false)", async () => {
    setLoggedOut();
    const user = userEvent.setup();
    renderAuraShell("/");

    const leftToggle = screen.getByRole("button", { name: "Toggle sidebar" });
    // Default starts collapsed: aria-pressed="false" (mirrors how the
    // right sidekick reads aria-pressed=false when collapsed).
    expect(leftToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(leftToggle);

    // Open: aria-pressed="true" — same boolean contract as the right
    // sidekick toggle in `WindowControls.tsx`.
    expect(leftToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("double-clicking the left drawer toggle does not bubble to the titlebar's window-maximize handler", async () => {
    // `ShellTitlebar` installs a default double-click handler that
    // calls `windowCommand("maximize")`. Without an explicit
    // `stopPropagation` on the leading slot, fast double-taps on
    // the drawer button maximize the OS window — a regression worth
    // pinning here so the next refactor that touches `PublicLeading`
    // notices the constraint. The shared `lib/windowCommand` mock at
    // the top of this file lets us assert the no-call invariant.
    setLoggedOut();
    const user = userEvent.setup();
    const { windowCommand } = await import("../../lib/windowCommand");
    vi.mocked(windowCommand).mockClear();
    renderAuraShell("/");

    const leftToggle = screen.getByRole("button", { name: "Toggle sidebar" });
    await user.dblClick(leftToggle);

    expect(windowCommand).not.toHaveBeenCalledWith("maximize");
  });
});

/**
 * Advanced `/desktop` regression coverage. Two behaviours were lost
 * when DesktopShell was folded into AuraShell and are tracked here:
 *
 *   1. `data-desktop-mode` must live on the `.shell` root (the
 *      element with `data-testid="aura-shell"`). Several CSS
 *      selectors — most notably `.shell[data-desktop-mode] .mainPanel`
 *      in `AuraShell.module.css` — depend on that location to strip
 *      the main panel's solid background + 1px border so the
 *      wallpaper-backed `BackgroundLayer` bleeds edge-to-edge. When
 *      the attribute sat on the inner `.body` div, the selector
 *      never matched and the wallpaper got sliced.
 *
 *   2. The left sidebar Lane must collapse to width 0 on `/desktop`.
 *      `DesktopApp.LeftPanel` returns `null`, so the body is empty,
 *      but the `<PanelSearch>` row + `<ModeToggle>` would otherwise
 *      keep the lane open and visibly cover the wallpaper. Legacy
 *      `DesktopShell` had this via `<Lane collapsed={isDesktop}
 *      animateCollapse={false}>`; `AuraSidebar` now mirrors the
 *      behaviour off the `isDesktop` prop AuraShell threads in.
 */
describe("AuraShell — advanced /desktop chrome", () => {
  beforeEach(() => {
    // `desktopModeActive = isDesktop && backgroundHydrated`. The
    // store starts in an unhydrated state in the no-image-slot
    // default, but the `data-desktop-mode` flip should be observable
    // immediately, so we mark it hydrated up front.
    useDesktopBackgroundStore.setState({ hydrated: true });
  });

  it("stamps `data-desktop-mode` on the `.shell` root (not the inner `.body`) when on /desktop in advanced mode", () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "advanced" });

    renderAuraShell("/desktop");

    const shell = screen.getByTestId("aura-shell");
    expect(shell).toHaveAttribute("data-desktop-mode", "true");
    // No descendant of `.shell` should carry the attribute — it used
    // to live on the inner `.body` div but module CSS selectors like
    // `.shell[data-desktop-mode] .mainPanel` only resolve when the
    // attribute is on the shell root itself. `querySelector` walks
    // descendants only (not the root), so a single nullish assertion
    // pins both the location move and the no-duplicate invariant.
    expect(shell.querySelector("[data-desktop-mode]")).toBeNull();
  });

  it("does not stamp `data-desktop-mode` on /chat in advanced mode (only `/desktop` activates it)", () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "advanced" });

    renderAuraShell("/chat");

    const shell = screen.getByTestId("aura-shell");
    expect(shell).not.toHaveAttribute("data-desktop-mode");
  });

  it("does not stamp `data-desktop-mode` on /desktop in Simple mode (Simple pins ChatApp regardless of URL)", () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "simple" });

    renderAuraShell("/desktop");

    const shell = screen.getByTestId("aura-shell");
    expect(shell).not.toHaveAttribute("data-desktop-mode");
  });

  it("collapses the sidebar Lane to 0 width on /desktop in advanced mode (wallpaper-edge-to-edge)", () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "advanced" });

    renderAuraShell("/desktop");

    const sidebar = screen.getByTestId("aura-sidebar");
    const lane = sidebar.querySelector<HTMLElement>("[data-lane]");
    expect(lane).not.toBeNull();
    // Lane writes the resolved width onto inline `style.width`;
    // `collapsed=true` short-circuits to 0 regardless of the
    // persisted user-resized value.
    expect(lane?.style.width).toBe("0px");
  });

  it("re-expands the sidebar Lane when navigating away from /desktop without remounting it", async () => {
    setLoggedIn();
    useUIModeStore.setState({ mode: "advanced" });

    renderAuraShell("/desktop");

    const sidebar = screen.getByTestId("aura-sidebar");
    const laneBefore = sidebar.querySelector<HTMLElement>("[data-lane]");
    expect(laneBefore).not.toBeNull();
    expect(laneBefore?.style.width).toBe("0px");

    // Flip into Simple mode (which pins ChatApp) to take the user
    // off `/desktop`'s collapsed path — the simplest way to assert
    // re-expansion without a navigate(). The Lane wrapper must keep
    // DOM identity (same invariant as test (a) above).
    await act(async () => {
      useUIModeStore.setState({ mode: "simple" });
    });

    const laneAfter = sidebar.querySelector<HTMLElement>("[data-lane]");
    expect(laneAfter).toBe(laneBefore);
    expect(laneAfter?.style.width).not.toBe("0px");
  });
});
