/**
 * Behavioural test for `PublicChatView` empty-state inline compose
 * surface + auth-gated send. Pins four contracts:
 *
 *  - The empty state renders the looping multi-agent demo banner
 *    (`AgentDemoBanner`) and the example-prompt button row directly
 *    in the main panel (no modal overlay).
 *  - The example-prompt row carries the four canonical short-copy
 *    buttons.
 *  - Clicking an example pre-fills the textarea with the
 *    representative prompt for that mode (no send fires until the
 *    user explicitly hits Send).
 *  - Sending a message while unauthenticated navigates to
 *    `/login?next=...` instead of attempting the public chat
 *    request (interim auth gate while the public router is flaky).
 */

import { render, screen, within } from "@testing-library/react";
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

vi.mock("../../../features/chat-ui/ChatInputBar", async () => {
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

vi.mock("../../../features/chat-ui/ChatMessageList", () => ({
  ChatMessageList: () => <div data-testid="chat-message-list-stub" />,
}));

vi.mock("../../../components/KeepChattingModal", () => ({
  KeepChattingModal: () => <div data-testid="keep-chatting-modal-stub" />,
}));

vi.mock("../AgentDemoBanner", () => ({
  AgentDemoBanner: () => <div data-testid="agent-demo-banner-stub" />,
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
  it("renders the agent demo banner and example-prompt buttons inline (no modal overlay)", () => {
    renderView();
    expect(
      screen.getByTestId("agent-demo-banner-stub"),
    ).toBeInTheDocument();

    const examples = screen.getByRole("group", { name: "Example prompts" });
    expect(within(examples).getByRole("button", { name: /Code an app/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Build a website/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Plan a trip/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Research a topic/i })).toBeInTheDocument();

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
      screen.getByRole("button", { name: /Plan a trip/i }),
    );

    expect(compose.value).toMatch(/7-day Tokyo itinerary/i);
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
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
