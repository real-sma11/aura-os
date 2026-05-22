/**
 * Smoke test for `LoggedOutShell` — the top-level layout shell of
 * the anonymous web experience. Confirms the three regions of the
 * shell mount together (titlebar, sessions sidebar, main outlet)
 * without throwing, with the heavier zui chrome and theme/wallpaper
 * machinery stubbed so the test stays focused on the component's
 * own composition contract instead of transitive setup.
 */

import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePublicChatStore } from "../../stores/public-chat-store";

vi.mock("@cypher-asi/zui", () => ({
  Topbar: ({
    icon,
    title,
    actions,
  }: {
    icon?: React.ReactNode;
    title?: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div data-testid="zui-topbar-stub">
      <div>{icon}</div>
      <div>{title}</div>
      <div>{actions}</div>
    </div>
  ),
  // PanelSearch (used by the new sidebar search row) imports `Input`
  // from zui. The lightweight stub below preserves placeholder /
  // value / onChange behaviour so test queries against the search
  // box continue to work without booting the full zui package.
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
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

vi.mock("../../components/DesktopShell/BackgroundLayer", () => ({
  BackgroundLayer: () => <div data-testid="background-layer-stub" />,
}));

vi.mock("./LoginOverlay", () => ({
  LoginOverlay: () => <div data-testid="login-overlay-stub" role="dialog" />,
}));

import { LoggedOutShell } from "./LoggedOutShell";

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

function renderShell(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route element={<LoggedOutShell />}>
          <Route
            path="/"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/login"
            element={<div data-testid="outlet-child">child route</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // The store module is shared across the suite so reset to a known
  // empty state between tests; otherwise sessions seeded by one test
  // bleed into the next and the "+" reuse behaviour reads as flaky.
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: null,
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("LoggedOutShell", () => {
  it("mounts the titlebar, sidebar, and outlet without crashing", () => {
    renderShell();
    // Titlebar rendered (via the zui Topbar stub).
    expect(screen.getByTestId("zui-topbar-stub")).toBeInTheDocument();
    // Background layer rendered (stubbed away from theme + wallpaper).
    expect(screen.getByTestId("background-layer-stub")).toBeInTheDocument();
    // Sidebar search input — proves the sidebar header mounted.
    expect(
      screen.getByPlaceholderText("Search"),
    ).toBeInTheDocument();
    // Simple/Advanced toggle is rendered under the search. The
    // toggle is built on `SlidingPills`, so its segments expose
    // `role="radio"` (matches the chat input mode selector).
    expect(
      screen.getByRole("radio", { name: "Simple" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Advanced" }),
    ).toBeInTheDocument();
    // The "+" button on the sidebar is reachable (a11y-labelled). It
    // now lives in the search row's action slot rather than a
    // dedicated `Chats` header.
    expect(
      screen.getByRole("button", { name: "New chat" }),
    ).toBeInTheDocument();
    // The outlet child rendered into the main panel.
    expect(screen.getByTestId("outlet-child")).toBeInTheDocument();
  });

  it("surfaces the marketing footer links on first paint without an upsell card", () => {
    renderShell();
    expect(
      screen.getByRole("link", { name: "Product" }),
    ).toHaveAttribute("href", "https://aura.ai/product");
    // The upsell card was removed because the titlebar already
    // exposes a "Log in" / "Sign up" CTA pair — having a duplicate
    // affordance at the bottom of the rail crowded the footer.
    expect(
      screen.queryByText("Get responses tailored to you"),
    ).not.toBeInTheDocument();
  });

  it("does not mount the LoginOverlay on the public chat route", () => {
    renderShell("/");
    expect(screen.queryByTestId("login-overlay-stub")).not.toBeInTheDocument();
  });

  it("mounts the LoginOverlay on top of the shell when the active route is /login", () => {
    renderShell("/login");
    // Shell still mounts (chat surface stays visible behind the
    // overlay so the visitor can dismiss the modal back to public
    // mode without losing context).
    expect(screen.getByTestId("outlet-child")).toBeInTheDocument();
    expect(screen.getByTestId("login-overlay-stub")).toBeInTheDocument();
  });

  it("reuses an existing empty session when '+' is clicked instead of accumulating orphan rows", async () => {
    const user = userEvent.setup();
    let emptyId = "";
    let titledId = "";
    act(() => {
      // sessionOrder is newest-first. Seed a titled session first
      // (older), then an empty session (newer, "New chat" placeholder)
      // so the empty row sits at the head of the list — the
      // configuration the visitor sees right after sending a first
      // message in their previous chat.
      titledId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(titledId, "first chat");
      emptyId = usePublicChatStore.getState().createSession();
    });

    renderShell(`/?session=${titledId}`);

    expect(usePublicChatStore.getState().sessionOrder).toEqual([
      emptyId,
      titledId,
    ]);

    // The accessible name "New chat" matches both the search-row "+"
    // button (aria-label) AND any session row whose title is still
    // the default placeholder, so we filter by `title=` to land on
    // the search-header affordance specifically.
    const plusBtn = screen
      .getAllByRole("button", { name: "New chat" })
      .find((b) => b.getAttribute("title") === "New chat");
    expect(plusBtn).toBeDefined();
    await user.click(plusBtn!);

    // Pressing "+" should reuse the existing empty session — no new
    // row in the store, and the URL flips to that session id so the
    // chat view re-renders against an empty canvas. Without this
    // dedupe, every press accumulates another orphan "New chat" row
    // pointing at an empty canvas, and a visitor sitting on a
    // populated chat sees the press as "the + button didn't take me
    // to a new chat screen" because the destination canvas already
    // existed but was hidden behind the previous session.
    expect(usePublicChatStore.getState().sessionOrder).toEqual([
      emptyId,
      titledId,
    ]);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/?session=${emptyId}`,
    );
  });

  it("mints a fresh session for '+' when every existing session has at least one turn", async () => {
    const user = userEvent.setup();
    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(firstId, "first chat");
      secondId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(secondId, "second chat");
    });

    renderShell(`/?session=${secondId}`);
    const beforeOrder = [...usePublicChatStore.getState().sessionOrder];

    await user.click(
      screen.getByRole("button", { name: "New chat" }),
    );

    const afterOrder = usePublicChatStore.getState().sessionOrder;
    // Exactly one new id appended at the head — the dedupe falls
    // through to `createSession()` because no zero-turn session
    // existed to reuse.
    expect(afterOrder).toHaveLength(beforeOrder.length + 1);
    const newId = afterOrder[0];
    expect(beforeOrder).not.toContain(newId);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/?session=${newId}`,
    );
  });
});
