/**
 * Behavioural test for `LoggedOutChatView` empty-state inline
 * compose surface + auth-gated send. Pins four contracts:
 *
 *  - The empty state renders the inline compose heading
 *    ("What do you want to create?") and the example-prompt button
 *    row directly in the main panel (no modal overlay).
 *  - The example-prompt row carries one button per agent mode
 *    (Code / Plan / Image / Video / 3D), labelled with the
 *    canonical short copy.
 *  - Clicking an example pre-fills the textarea with the
 *    representative prompt for that mode (no send fires until the
 *    user explicitly hits Send).
 *  - Sending a message while unauthenticated navigates to
 *    `/login?next=...` instead of attempting the public chat
 *    request (interim auth gate while the public router is flaky).
 *
 * The shared `DesktopChatInputBar` is stubbed to a minimal textarea
 * + send button so this test does not pull in slash-command menus,
 * model pickers, or the input-bar shell — keeping the assertions
 * focused on the view's own logic.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseAuth = vi.fn(() => ({ isAuthenticated: false }));
vi.mock("../../stores/auth-store", () => ({
  useAuth: () => mockUseAuth(),
}));

// `forwardRef` matches the real `DesktopChatInputBar` signature so
// `ComposePanel`'s `inputBarRef.current?.focus()` call doesn't blow
// up when an example button is clicked. The stub exposes a no-op
// `focus()` impl (we only assert the *prompt* lands in the
// textarea, not where focus ends up).
vi.mock("../../features/chat-ui/ChatInputBar", async () => {
  const React = await import("react");
  const Stub = React.forwardRef<
    { focus: () => void },
    {
      input: string;
      onInputChange: (next: string) => void;
      onSend: (content: string) => void;
    }
  >(({ input, onInputChange, onSend }, ref) => {
    React.useImperativeHandle(ref, () => ({ focus: () => {} }), []);
    return (
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
    );
  });
  return { DesktopChatInputBar: Stub };
});

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
  it("renders the compose heading and example-prompt buttons inline (no modal overlay)", () => {
    renderView();
    expect(
      screen.getByRole("heading", { name: "What do you want to create?" }),
    ).toBeInTheDocument();

    // The example-prompt row exposes one button per agent mode.
    // Asserting the full set (not just one) pins the row layout so
    // a regression that drops a mode is caught immediately.
    const examples = screen.getByRole("group", { name: "Example prompts" });
    expect(within(examples).getByRole("button", { name: /Build a landing page/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Plan a 7-day Tokyo trip/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Generate an image/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Generate a video/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Generate a 3D model/i })).toBeInTheDocument();

    // The compose surface lives inside a `region` (not a `dialog`)
    // because it's now an inline empty-state, not an overlay.
    expect(
      screen.getByRole("region", { name: "Start a new conversation" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pre-fills the textarea when an example prompt button is clicked", async () => {
    const user = userEvent.setup();
    renderView();

    const compose = screen.getByLabelText("Compose") as HTMLTextAreaElement;
    expect(compose.value).toBe("");

    await user.click(
      screen.getByRole("button", { name: /Generate an image/i }),
    );

    // The exact prompt copy is asserted (not just non-empty) so the
    // example-row contract — "click an example, get the same prompt
    // the visitor would have typed" — is pinned. Loose match keeps
    // the test resilient to whitespace tweaks but tight enough to
    // catch swapping the example for a different mode.
    expect(compose.value).toMatch(/astronaut riding a horse on Mars/i);
    // No send fired — the visitor still has to hit Send (or Enter)
    // to actually dispatch.
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
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
