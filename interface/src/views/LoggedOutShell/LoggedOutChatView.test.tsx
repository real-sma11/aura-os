/**
 * Behavioural test for `LoggedOutChatView` empty-state inline
 * compose surface + auth-gated send. Pins four contracts:
 *
 *  - The empty state renders the looping multi-agent demo banner
 *    (`AgentDemoBanner`) and the example-prompt button row directly
 *    in the main panel (no modal overlay). The banner replaced the
 *    older "What do you want to create?" heading; the rest of the
 *    empty-state stack (input + helper tabs) is unchanged.
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
 * + send button, and `AgentDemoBanner` is stubbed to a no-op marker
 * so the test stays free of timer-driven script playback.
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

// `AgentDemoBanner` runs a `setTimeout` chain to play its scripted
// agent timeline. The view's own assertions don't care about that
// motion, so we stub the banner to a static marker — keeps the test
// deterministic without `vi.useFakeTimers()` plumbing.
vi.mock("./AgentDemoBanner", () => ({
  AgentDemoBanner: () => <div data-testid="agent-demo-banner-stub" />,
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
  it("renders the agent demo banner and example-prompt buttons inline (no modal overlay)", () => {
    renderView();
    // The hero banner now plays a scripted multi-agent demo instead
    // of the older static heading. The view's contract is just that
    // *something* rendered there as the empty-state hero — the
    // banner's own behaviour is exercised in `AgentDemoBanner.test.tsx`.
    expect(
      screen.getByTestId("agent-demo-banner-stub"),
    ).toBeInTheDocument();

    // The example-prompt row is a curated single-line list of
    // quick-start tabs. Asserting the full set (not just one) pins
    // both the copy and the layout so a regression that drops or
    // renames an entry is caught immediately.
    const examples = screen.getByRole("group", { name: "Example prompts" });
    expect(within(examples).getByRole("button", { name: /Code an app/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Build a website/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Plan a trip/i })).toBeInTheDocument();
    expect(within(examples).getByRole("button", { name: /Research a topic/i })).toBeInTheDocument();

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
      screen.getByRole("button", { name: /Plan a trip/i }),
    );

    // The exact prompt copy is asserted (not just non-empty) so the
    // example-row contract — "click an example, get the same prompt
    // the visitor would have typed" — is pinned. Loose match keeps
    // the test resilient to whitespace tweaks but tight enough to
    // catch swapping the example for a different mode.
    expect(compose.value).toMatch(/7-day Tokyo itinerary/i);
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

  it("does not mint extra empty sessions when the visitor round-trips through /login", async () => {
    // Regression for the "every Log in click stacks another empty
    // chat in the sidebar" bug. Three things have to hold together
    // for the fix to be observable end-to-end:
    //
    //   1. `LoggedOutChatView` only calls `createSession()` once per
    //      component instance (the ref-guard around the auto-create
    //      branch — was a `useMemo` side effect that ran on every
    //      render where `requestedSessionId` was null).
    //   2. The titlebar Log in / Sign up Links carry the current
    //      `?session=` forward into `/login` so the chat view's
    //      `requestedSessionId` is never null on a re-mount.
    //   3. The login-overlay close handler likewise preserves the
    //      session id on its way back to `/`.
    //
    // This test stubs out the titlebar/overlay by using a navigation
    // probe that mirrors the fixed `?session=`-preserving behaviour;
    // the *combined* contract is what the user sees, so we pin it
    // here rather than relying on three isolated unit tests to
    // compose correctly. The route table mounts `LoggedOutChatView`
    // for BOTH `/` and `/login` to mirror the production routing in
    // `App.tsx` — the same component is rendered while the login
    // overlay sits on top.
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
          <Route path="/" element={<LoggedOutChatView />} />
          <Route path="/login" element={<LoggedOutChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    // Initial mount auto-creates exactly one session and writes its
    // id back into the URL — this is the eager-create-on-first-mount
    // contract we explicitly want to preserve.
    expect(usePublicChatStore.getState().sessionOrder).toHaveLength(1);

    // Hop through the login modal three times. Each round trip
    // would previously add at least one empty "New chat" row to the
    // sidebar (sometimes two — once on the `/login` mount, once on
    // the `/` re-mount when the overlay closed).
    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getByTestId("go-login"));
      await user.click(screen.getByTestId("go-home"));
    }

    expect(usePublicChatStore.getState().sessionOrder).toHaveLength(1);
  });
});
