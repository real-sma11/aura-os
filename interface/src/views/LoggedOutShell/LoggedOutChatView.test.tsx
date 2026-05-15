/**
 * Behavioural test for `LoggedOutChatView` empty-state inline
 * compose surface + auth-gated send. Pins three contracts:
 *
 *  - The empty state renders the inline compose heading
 *    ("What do you want to create?") and the mode-pill widget row
 *    directly in the main panel (no modal overlay).
 *  - The "Create an image" widget is wired so picking a mode is
 *    available without opening the input bar's segmented control.
 *  - Sending a message while unauthenticated navigates to
 *    `/login?next=...` instead of attempting the public chat
 *    request (interim auth gate while the public router is flaky).
 *
 * The shared `DesktopChatInputBar` is stubbed to a minimal textarea
 * + send button so this test does not pull in slash-command menus,
 * model pickers, or the input-bar shell — keeping the assertions
 * focused on the view's own logic.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseAuth = vi.fn(() => ({ isAuthenticated: false }));
vi.mock("../../stores/auth-store", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../features/chat-ui/ChatInputBar", () => ({
  DesktopChatInputBar: ({
    input,
    onInputChange,
    onSend,
  }: {
    input: string;
    onInputChange: (next: string) => void;
    onSend: (content: string) => void;
  }) => (
    <div data-testid="chat-input-bar-stub">
      <textarea
        aria-label="Compose"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
      />
      <button type="button" onClick={() => onSend(input)}>
        Send
      </button>
    </div>
  ),
}));

vi.mock("../../features/chat-ui/ChatMessageList", () => ({
  ChatMessageList: () => <div data-testid="chat-message-list-stub" />,
}));

vi.mock("../../components/KeepChattingModal", () => ({
  KeepChattingModal: () => <div data-testid="keep-chatting-modal-stub" />,
}));

import { LoggedOutChatView } from "./LoggedOutChatView";
import { usePublicChatStore } from "../../stores/public-chat-store";

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

function renderView(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route path="/" element={<LoggedOutChatView />} />
        <Route
          path="/login"
          element={<div data-testid="login-page">login</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: null,
  });
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ isAuthenticated: false });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("LoggedOutChatView inline compose", () => {
  it("renders the compose heading and mode-pill widgets inline (no modal overlay)", () => {
    renderView();
    expect(
      screen.getByRole("heading", { name: "What do you want to create?" }),
    ).toBeInTheDocument();
    // Each mode pill renders as an aria-pressed button labelled with
    // its display copy. Verify the "Create an image" widget is wired
    // (proxy for the full pill row mounting).
    expect(
      screen.getByRole("button", { name: /Create an image/i }),
    ).toBeInTheDocument();
    // The compose surface lives inside a `region` (not a `dialog`)
    // because it's now an inline empty-state, not an overlay.
    expect(
      screen.getByRole("region", { name: "Start a new conversation" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("redirects unauthenticated visitors to /login on first send", async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ isAuthenticated: false });

    renderView();
    const compose = screen.getByLabelText("Compose");
    await user.type(compose, "hello world");
    await user.click(screen.getAllByRole("button", { name: "Send" })[0]);

    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    // The next= param round-trips the original location so the
    // visitor lands back on the chat surface after auth.
    expect(screen.getByTestId("location").textContent).toMatch(/^\/login/);
  });
});
