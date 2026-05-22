/**
 * Behavioural test for `PublicChatView` empty-state inline compose
 * surface + session lifecycle. Pins the contracts:
 *
 *  - The empty state renders the windowed mock-Aura-app hero
 *    (`MockAuraApp`, mounted via `ComposePanel`) directly in the
 *    main panel with no modal overlay.
 *  - Round-tripping through `/login` does not mint extra empty
 *    sessions in the public-chat store.
 *
 * Note: the example-prompt pre-fill case was removed in phase 0
 * along with the helper pills — there are no example-prompt
 * buttons in the empty state anymore, so the parent no longer
 * needs to forward representative prompts into the textarea.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseAuth = vi.fn(() => ({ isAuthenticated: false }));
vi.mock("../../../stores/auth-store", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../PublicComposeInput", async () => {
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
      <div data-testid="public-compose-input-stub">
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
  return { PublicComposeInput: Stub };
});

vi.mock("../../../features/chat-ui/ChatMessageList", () => ({
  ChatMessageList: () => <div data-testid="chat-message-list-stub" />,
}));

vi.mock("../../../components/KeepChattingModal", () => ({
  KeepChattingModal: () => <div data-testid="keep-chatting-modal-stub" />,
}));

vi.mock("../MockAuraApp", () => ({
  MockAuraApp: () => <div data-testid="mock-aura-app-stub" />,
}));

import { PublicChatView } from "./PublicChatView";
import { usePublicChatStore } from "../../../stores/public-chat-store";

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
        <Route path="/" element={<PublicChatView />} />
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

describe("PublicChatView inline compose", () => {
  it("renders the mock-Aura-app hero in the empty state (no modal overlay)", () => {
    renderView();
    expect(
      screen.getByTestId("mock-aura-app-stub"),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("region", { name: "Start a new conversation" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("keep-chatting-modal-stub"),
    ).not.toBeInTheDocument();
  });

  it("does not mint extra empty sessions when the visitor round-trips through /login", async () => {
    const user = userEvent.setup();

    function NavProbe() {
      const navigate = useNavigate();
      const location = useLocation();
      const targets =
        location.pathname === "/"
          ? { label: "go-login", to: "/login" }
          : { label: "go-home", to: "/" };
      return (
        <button
          data-testid={targets.label}
          onClick={() =>
            navigate({ pathname: targets.to, search: location.search })
          }
        />
      );
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <NavProbe />
        <Routes>
          <Route path="/" element={<PublicChatView />} />
          <Route path="/login" element={<PublicChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(usePublicChatStore.getState().sessionOrder).toHaveLength(1);

    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getByTestId("go-login"));
      await user.click(screen.getByTestId("go-home"));
    }

    expect(usePublicChatStore.getState().sessionOrder).toHaveLength(1);
  });
});
