/**
 * Phase 4 `p4_simple_pin_chat` regression coverage for the route
 * guard. Verifies:
 *
 *  - In Simple mode, any non-`/chat` pathname renders `<Navigate />`
 *    to `/chat` (the user never sees the wrapped content).
 *  - In Advanced mode, the wrapped content renders unchanged.
 *  - In Public mode (logged-out), the wrapped content renders
 *    unchanged — the guard is authed-shell-only, the public route
 *    tree handles its own redirects.
 *  - `/chat/<sub>` paths are NOT redirected (so deep links like
 *    `/chat/session-123` survive Simple mode).
 *  - `isChatPath` correctly identifies `/chat` and any subpath.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatRedirectGuard, isChatPath } from "./ChatRedirectGuard";
import { useUIModeStore } from "../../stores/ui-mode-store";
import { useAuthStore } from "../../stores/auth-store";

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

function PathProbe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="probe-path">{location.pathname}</div>;
}

function renderGuardedRouter(initialPath: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/chat"
          element={
            <ChatRedirectGuard>
              <div data-testid="guarded-content">chat content</div>
            </ChatRedirectGuard>
          }
        />
        <Route
          path="/chat/:sessionId"
          element={
            <ChatRedirectGuard>
              <div data-testid="guarded-content">chat session</div>
            </ChatRedirectGuard>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <ChatRedirectGuard>
              <div data-testid="guarded-content">projects content</div>
            </ChatRedirectGuard>
          }
        />
        <Route
          path="/notes"
          element={
            <ChatRedirectGuard>
              <div data-testid="guarded-content">notes content</div>
            </ChatRedirectGuard>
          }
        />
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: TEST_USER });
  useUIModeStore.setState({ mode: "advanced" });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
  useUIModeStore.setState({ mode: "simple" });
});

describe("ChatRedirectGuard — Simple mode", () => {
  beforeEach(() => {
    useUIModeStore.setState({ mode: "simple" });
  });

  it("redirects /projects/abc to /chat (children never render)", () => {
    renderGuardedRouter("/projects/abc");
    // The guarded `/projects/:id` element returned `<Navigate to="/chat" />`,
    // so we land on `/chat` and its guarded content renders instead.
    expect(screen.getByTestId("guarded-content")).toHaveTextContent(
      "chat content",
    );
  });

  it("redirects /notes to /chat", () => {
    renderGuardedRouter("/notes");
    expect(screen.getByTestId("guarded-content")).toHaveTextContent(
      "chat content",
    );
  });

  it("does NOT redirect /chat (children render in place)", () => {
    renderGuardedRouter("/chat");
    expect(screen.getByTestId("guarded-content")).toHaveTextContent(
      "chat content",
    );
  });

  it("does NOT redirect /chat/<session-id> subpaths", () => {
    renderGuardedRouter("/chat/session-123");
    expect(screen.getByTestId("guarded-content")).toHaveTextContent(
      "chat session",
    );
  });
});

describe("ChatRedirectGuard — Advanced mode", () => {
  beforeEach(() => {
    useUIModeStore.setState({ mode: "advanced" });
  });

  it("renders /projects/abc in place (no redirect)", () => {
    renderGuardedRouter("/projects/abc");
    expect(screen.getByTestId("guarded-content")).toHaveTextContent(
      "projects content",
    );
  });

  it("renders /notes in place (no redirect)", () => {
    renderGuardedRouter("/notes");
    expect(screen.getByTestId("guarded-content")).toHaveTextContent(
      "notes content",
    );
  });
});

describe("ChatRedirectGuard — Public mode (logged-out)", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null });
    // The store mode value is whatever the user last persisted; the
    // squash to "public" happens inside `useEffectiveMode`.
    useUIModeStore.setState({ mode: "simple" });
  });

  it("does not redirect when the user is logged out (effective mode is public)", () => {
    renderGuardedRouter("/projects/abc");
    expect(screen.getByTestId("guarded-content")).toHaveTextContent(
      "projects content",
    );
  });
});

describe("isChatPath", () => {
  it("matches the canonical /chat path", () => {
    expect(isChatPath("/chat")).toBe(true);
  });

  it("matches subpaths like /chat/session-123", () => {
    expect(isChatPath("/chat/session-123")).toBe(true);
    expect(isChatPath("/chat/")).toBe(true);
  });

  it("does NOT match unrelated paths starting with the same letters", () => {
    expect(isChatPath("/chats")).toBe(false);
    expect(isChatPath("/chatroom")).toBe(false);
    expect(isChatPath("/projects/chat")).toBe(false);
  });

  it("does NOT match the root or other apps", () => {
    expect(isChatPath("/")).toBe(false);
    expect(isChatPath("/projects/abc")).toBe(false);
    expect(isChatPath("/notes")).toBe(false);
  });
});
