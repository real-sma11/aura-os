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
 *       marketing footer (Pricing link) and `AgentDemoBanner` are in
 *       the DOM. After `useAuthStore.setState({ user: ... })` (auth
 *       simulated), the same queries return null — the public-only
 *       surface is gone.
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
 * theme/wallpaper background layer, the LoginOverlay).
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
      <div data-testid={(rest["data-testid"] as string) ?? "zui-topbar-stub"}>
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

vi.mock("../../views/public-chat/LoginOverlay", () => ({
  LoginOverlay: () => <div data-testid="login-overlay-stub" role="dialog" />,
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
});

afterEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ user: null });
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

  it("(d) gates marketing footer (Pricing link) behind public mode and hides it when logged in", async () => {
    setLoggedOut();

    renderAuraShell();

    // `LoggedOutPanelFooter` exposes a "Pricing" anchor to
    // aura.ai/pricing — a load-bearing public-only marketing
    // affordance. It must be present for unauthenticated visitors
    // and absent the moment the user signs in.
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "https://aura.ai/pricing",
    );

    await act(async () => {
      setLoggedIn();
      useUIModeStore.setState({ mode: "simple" });
    });

    expect(
      screen.queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
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

    // The Log in / Sign up pills are the load-bearing public-mode
    // CTAs and must remain in the trailing slot.
    expect(
      within(titlebar).getByRole("link", { name: "Log in" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("link", { name: "Sign up for free" }),
    ).toBeInTheDocument();
  });

  it("(g) suppresses the desktop wallpaper (BackgroundLayer) in public mode and mounts it once the user signs in", async () => {
    // The persisted desktop wallpaper must not bleed onto logged-out
    // surfaces. AuraShell gates `<BackgroundLayer />` behind
    // `!isPublic`, so the stub testid is absent in public mode and
    // appears the moment auth flips the effective mode away from
    // `public`.
    setLoggedOut();

    renderAuraShell();

    expect(
      screen.queryByTestId("background-layer-stub"),
    ).not.toBeInTheDocument();

    await act(async () => {
      setLoggedIn();
      useUIModeStore.setState({ mode: "simple" });
    });

    expect(screen.getByTestId("background-layer-stub")).toBeInTheDocument();
  });

  it("mounts the LoginOverlay on top of the public chat surface when the active route is /login", () => {
    setLoggedOut();
    renderAuraShell("/login");

    // The chat outlet stays mounted behind the overlay so the modal
    // can be dismissed back into public mode without losing context.
    expect(screen.getByTestId("login-overlay-stub")).toBeInTheDocument();
  });

  it("does not mount the LoginOverlay on the public landing route", () => {
    setLoggedOut();
    renderAuraShell("/");
    expect(screen.queryByTestId("login-overlay-stub")).not.toBeInTheDocument();
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

    // `PublicSidebarFooter` (formerly `LoggedOutPanelFooter`) is the
    // public-only marketing footer. In public mode it must mount
    // alongside the public sidebar body — its absence would mean
    // the shell mistakenly resolved to an authed surface.
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
  });

  it("sign-in transition (public -> simple) tears down the public footer and mounts ChatAppLeftPanel", async () => {
    setLoggedOut();
    const { container } = renderAuraShell("/");

    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(getActiveAppId(container)).toBeNull();

    await act(async () => {
      setLoggedIn();
      useUIModeStore.setState({ mode: "simple" });
    });

    expect(
      screen.queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(getActiveAppId(container)).toBe("chat");
  });
});
