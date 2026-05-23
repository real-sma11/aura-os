/**
 * Behavioural test for `PublicChatView`'s public chat layout.
 *
 * The public surface keeps the decorative `MockAuraApp` frame and
 * persona controls, then mounts a simple transcript + input on
 * `/chat`. These tests pin that contract and the persona-theme swap
 * wiring.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { streamPublicChatMock } = vi.hoisted(() => ({
  streamPublicChatMock: vi.fn(),
}));

vi.mock("../../../api/public-chat", () => ({
  streamPublicChat: streamPublicChatMock,
}));

// Stub `MockAuraApp` so the test surfaces just the wallpaper-prop
// contract — the real component pulls in the scripted DM windows
// and full chrome that these chat-surface tests don't need to exercise.
// The stub echoes BOTH the current desktop bg URL AND the
// outgoing snapshot's URL into data attributes so the layered
// cross-fade is observable, plus the current `activePersonaIndex`
// so we can pin that the bottom-left avatar dock and the right-
// edge `PersonaTickRail` share one piece of state. A pair of
// hidden click targets simulate the dock firing
// `onPersonaSelect(1)` / `onPersonaSelect(2)` without pulling
// the real avatar buttons in.
vi.mock("../MockAuraApp", () => ({
  MockAuraApp: ({
    desktopBackgroundUrl,
    outgoingDesktopBackground,
    activePersonaIndex,
    onPersonaSelect,
  }: {
    desktopBackgroundUrl?: string | null;
    outgoingDesktopBackground?: {
      readonly url: string | null;
      readonly fadeKey: number;
    } | null;
    activePersonaIndex?: number;
    onPersonaSelect?: (index: number) => void;
  }) => (
    <div
      data-testid="mock-aura-app-stub"
      data-desktop-bg={desktopBackgroundUrl ?? ""}
      data-outgoing-desktop-bg={outgoingDesktopBackground?.url ?? ""}
      data-outgoing-fade-key={
        outgoingDesktopBackground?.fadeKey != null
          ? String(outgoingDesktopBackground.fadeKey)
          : ""
      }
      data-active-persona-index={
        activePersonaIndex != null ? String(activePersonaIndex) : ""
      }
    >
      <button
        type="button"
        data-testid="mock-aura-app-dock-select-solo-builder"
        onClick={() => onPersonaSelect?.(1)}
      />
      <button
        type="button"
        data-testid="mock-aura-app-dock-select-giga-brain"
        onClick={() => onPersonaSelect?.(2)}
      />
    </div>
  ),
}));

import { PublicChatView } from "./PublicChatView";
import { usePublicChatStore } from "../../../stores/public-chat-store";

function renderView(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PublicChatView />
    </MemoryRouter>,
  );
}

/**
 * Echoes the current router location into the DOM so navigation
 * effects triggered by the CTA can be asserted without coupling
 * the test to React Router internals.
 */
function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
    />
  );
}

function renderViewWithProbe(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<PublicChatView />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Tick buttons live inside the `<ul aria-label="Agent personas">`. */
function tickFor(name: string): HTMLElement {
  const list = screen.getByLabelText("Agent personas");
  return within(list).getByRole("button", { name });
}

/**
 * Panel rows live inside the open/close menu panel. The panel
 * carries `aria-hidden="true"` while closed (screen readers reach
 * personas via the tick buttons instead), so the query opts into
 * hidden elements to keep the helper usable in both states.
 */
function panelFor(name: string): HTMLElement {
  const panel = screen.getByTestId("persona-tick-rail-panel");
  return within(panel).getByRole("button", { name, hidden: true });
}

beforeEach(() => {
  window.localStorage.clear();
  streamPublicChatMock.mockImplementation(
    (args: { onDelta: (text: string) => void; onDone?: () => void }) => {
      args.onDelta("Hello from Aura");
      args.onDone?.();
      return { close: vi.fn() };
    },
  );
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: "guest-token",
    setupInFlight: false,
  });
});

afterEach(() => {
  window.localStorage.clear();
  streamPublicChatMock.mockReset();
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: null,
    setupInFlight: false,
  });
});

describe("PublicChatView", () => {
  it("renders the MockAuraApp hero inside the empty-state region", () => {
    renderView();
    expect(screen.getByTestId("mock-aura-app-stub")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Start a new conversation" }),
    ).toBeInTheDocument();
  });

  it("renders the single 'Create your agent' CTA button", () => {
    renderView();
    const buttons = screen.getAllByRole("button", { name: /create your agent/i });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute(
      "data-agent-surface",
      "public-landing-cta",
    );
  });

  it("navigates to /login?tab=register when the CTA button is clicked", () => {
    // Mirrors the destination used by the public shell's "Sign Up"
    // pill, so the AuraShell-mounted LoginOverlay opens with the
    // Create Account tab pre-selected (via `useLoginForm`'s
    // `?tab=register` seed effect).
    renderViewWithProbe();
    const probe = screen.getByTestId("location-probe");
    expect(probe).toHaveAttribute("data-pathname", "/");
    expect(probe).toHaveAttribute("data-search", "");

    fireEvent.click(
      screen.getByRole("button", { name: /create your agent/i }),
    );

    expect(probe).toHaveAttribute("data-pathname", "/login");
    expect(probe).toHaveAttribute("data-search", "?tab=register");
  });

  it("auto-selects an empty session and shows the simple chat input on /chat", async () => {
    renderViewWithProbe("/chat");

    expect(
      await screen.findByRole("textbox", { name: "Message Aura" }),
    ).toBeInTheDocument();

    const sessionOrder = usePublicChatStore.getState().sessionOrder;
    expect(sessionOrder).toHaveLength(1);
    expect(screen.getByTestId("location-probe")).toHaveAttribute(
      "data-pathname",
      "/chat",
    );
    expect(screen.getByTestId("location-probe")).toHaveAttribute(
      "data-search",
      `?session=${sessionOrder[0]}`,
    );
  });

  /*
   * The decorative `MockAuraApp` hero and the right-edge persona
   * `PersonaTickRail` are landing-only chrome. On `/chat` the visitor
   * is focused on talking to Aura, so both unmount entirely — the
   * chat surface, input bar, and persona page background own the
   * visual field without the demo desktop dominating the foreground
   * or the tick column distracting from the transcript. Pinned via
   * the two test ids the rest of the suite already uses for these
   * surfaces, so a regression that leaves either visible on the
   * chat page would also flip this assertion.
   */
  it("hides the MockAuraApp hero AND the persona tick rail on /chat", async () => {
    renderView("/chat");

    // Sanity: the chat input does render (proves we're really on the
    // chat surface and not a route-mismatch false-negative).
    expect(
      await screen.findByRole("textbox", { name: "Message Aura" }),
    ).toBeInTheDocument();

    expect(screen.queryByTestId("mock-aura-app-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("persona-tick-rail")).not.toBeInTheDocument();
  });

  it("renders the selected public chat transcript", () => {
    let sessionId = "";
    act(() => {
      sessionId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(sessionId, "hello aura");
      usePublicChatStore
        .getState()
        .appendAssistantToken(sessionId, "assistant-1", "hello human", "code");
      usePublicChatStore.getState().commitAssistant(sessionId, "assistant-1");
    });

    renderView(`/chat?session=${sessionId}`);

    expect(screen.getByText("hello aura")).toBeInTheDocument();
    expect(screen.getByText("hello human")).toBeInTheDocument();
  });

  it("sends a public chat turn through the existing stream client", async () => {
    const user = userEvent.setup();
    let sessionId = "";
    act(() => {
      sessionId = usePublicChatStore.getState().createSession();
    });
    renderView(`/chat?session=${sessionId}`);

    await user.type(
      screen.getByRole("textbox", { name: "Message Aura" }),
      "Can you help?",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(streamPublicChatMock).toHaveBeenCalledTimes(1));
    expect(streamPublicChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "guest-token",
        sessionId,
        message: "Can you help?",
        mode: "code",
      }),
    );
    expect(screen.getByText("Can you help?")).toBeInTheDocument();
    expect(screen.getByText("Hello from Aura")).toBeInTheDocument();
  });

  it("renders 6 persona ticks AND 6 panel rows including the Solo Builder slot", () => {
    renderView();
    const personas = [
      "Vibecoder",
      "Solo Builder",
      "Giga Brain",
      "Coordinator",
      "Researcher",
      "Cypher Punk",
    ];
    // Each persona is represented twice: once as a tick button in
    // the rail column, once as a row button inside the panel.
    for (const name of personas) {
      expect(tickFor(name)).toBeInTheDocument();
      expect(panelFor(name)).toBeInTheDocument();
    }
    expect(screen.getByTestId("persona-tick-rail")).toBeInTheDocument();
    expect(screen.getByTestId("persona-tick-rail-panel")).toBeInTheDocument();
  });

  it("starts closed with Vibecoder marked active and opens the menu on rail hover", () => {
    renderView();
    const rail = screen.getByTestId("persona-tick-rail");
    expect(rail).toHaveAttribute("data-panel-open", "false");

    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Researcher")).not.toHaveAttribute("aria-current");

    fireEvent.mouseEnter(rail);
    expect(rail).toHaveAttribute("data-panel-open", "true");
  });

  it("keeps the overlay open when the cursor exits via the viewport's right edge", () => {
    // The rail and its panel hug the viewport's right edge; a
    // rightward exit has no other content to interact with, so the
    // menu must stay open and only close on up / down / left exits
    // (or a row click). Drive fake timers so the 80ms close debounce
    // can be flushed deterministically without a real wall-clock wait.
    vi.useFakeTimers();
    try {
      renderView();
      const rail = screen.getByTestId("persona-tick-rail");

      fireEvent.mouseEnter(rail);
      expect(rail).toHaveAttribute("data-panel-open", "true");

      fireEvent.mouseLeave(rail, {
        clientX: window.innerWidth,
        clientY: 200,
      });
      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(rail).toHaveAttribute("data-panel-open", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the overlay when the cursor exits leftward (away from the right edge)", () => {
    // Companion to the right-exit test above: a non-right exit still
    // schedules the standard 80ms debounced close so the visitor can
    // dismiss the menu by moving the cursor back toward the chat
    // surface.
    vi.useFakeTimers();
    try {
      renderView();
      const rail = screen.getByTestId("persona-tick-rail");

      fireEvent.mouseEnter(rail);
      expect(rail).toHaveAttribute("data-panel-open", "true");

      fireEvent.mouseLeave(rail, { clientX: 100, clientY: 200 });
      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(rail).toHaveAttribute("data-panel-open", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits the persona selection AND closes the menu when a panel row is clicked", () => {
    renderView();
    const rail = screen.getByTestId("persona-tick-rail");
    fireEvent.mouseEnter(rail);
    expect(rail).toHaveAttribute("data-panel-open", "true");

    fireEvent.click(panelFor("Researcher"));

    // The selection promoted Researcher to active and the menu
    // immediately closed, dropping the visitor back to the
    // minimal tick column with the new selection painted.
    expect(rail).toHaveAttribute("data-panel-open", "false");
    expect(tickFor("Researcher")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Vibecoder")).not.toHaveAttribute("aria-current");
    expect(panelFor("Researcher")).toHaveAttribute("data-active", "true");
  });

  it("mounts the new persona's wallpaper + site bg immediately on click, with the OLD persona kept as a fading-out overlay until the dissolve completes", async () => {
    // Layered cross-fade contract: clicking a tick swaps the
    // committed persona in the SAME render as the click. The
    // previous persona is captured into an `outgoingDesktopBackground`
    // / outgoing `.siteBackground` snapshot that mounts ON TOP of
    // the new one with a 550ms fade-out animation. After
    // FADE_MS + 50ms the outgoing snapshot unmounts.
    vi.useFakeTimers();
    try {
      renderView();
      const heroStub = screen.getByTestId("mock-aura-app-stub");

      // Vibecoder is the default landing theme: the mock window's
      // wallpaper is the curated cyberpunk portrait. No outgoing
      // snapshot yet — nothing to dissolve out.
      expect(heroStub).toHaveAttribute(
        "data-desktop-bg",
        "/personas/vibecoder/desktop.png",
      );
      expect(heroStub).toHaveAttribute("data-outgoing-desktop-bg", "");
      const initialSiteBgImg = screen.getByTestId("public-chat-site-bg-image");
      expect(initialSiteBgImg).toHaveAttribute(
        "src",
        "/personas/vibecoder/site.png",
      );
      expect(
        screen.queryByTestId("public-chat-site-bg-outgoing"),
      ).not.toBeInTheDocument();

      fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
      fireEvent.click(panelFor("Solo Builder"));

      // Click immediately commits the new persona's wallpaper +
      // site bg. The OLD persona (vibecoder) is now the outgoing
      // snapshot mounted on top, so during the fade window BOTH
      // images coexist in the DOM and the test stub exposes them
      // via separate attributes.
      expect(heroStub).toHaveAttribute(
        "data-desktop-bg",
        "/personas/solo-builder/desktop.png",
      );
      expect(heroStub).toHaveAttribute(
        "data-outgoing-desktop-bg",
        "/personas/vibecoder/desktop.png",
      );
      expect(heroStub.getAttribute("data-outgoing-fade-key")).not.toBe("");
      expect(
        screen.getByTestId("public-chat-site-bg-image"),
      ).toHaveAttribute("src", "/personas/solo-builder/site.png");
      const outgoingSiteBg = screen.getByTestId(
        "public-chat-site-bg-outgoing",
      );
      const outgoingSiteBgImg = outgoingSiteBg.querySelector("img");
      expect(outgoingSiteBgImg).not.toBeNull();
      expect(outgoingSiteBgImg).toHaveAttribute(
        "src",
        "/personas/vibecoder/site.png",
      );

      // Advance past the 550ms fade-out window + 50ms teardown
      // grace. The outgoing layer unmounts and only the new
      // persona's snapshot remains in the DOM.
      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      expect(heroStub).toHaveAttribute(
        "data-desktop-bg",
        "/personas/solo-builder/desktop.png",
      );
      expect(heroStub).toHaveAttribute("data-outgoing-desktop-bg", "");
      expect(
        screen.queryByTestId("public-chat-site-bg-outgoing"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("public-chat-site-bg-image"),
      ).toHaveAttribute("src", "/personas/solo-builder/site.png");
      expect(
        document.querySelector('[data-persona-id="solo-builder"]'),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("flips the active tick AND the committed wallpaper/site bg in the SAME render as the click — only the outgoing overlay lingers", () => {
    // The previous "two-tier active vs committed" contract is gone:
    // active + committed advance together so the painted persona
    // matches the rail's aria-current immediately. The dissolve
    // effect now comes from the OUTGOING overlay layer being
    // captured at the moment of swap and animated to opacity 0.
    renderView();
    const heroStub = screen.getByTestId("mock-aura-app-stub");
    expect(heroStub).toHaveAttribute(
      "data-desktop-bg",
      "/personas/vibecoder/desktop.png",
    );

    fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
    fireEvent.click(panelFor("Solo Builder"));

    // Active tick + aria-current flip immediately.
    expect(tickFor("Solo Builder")).toHaveAttribute("aria-current", "true");

    // Committed bg + wallpaper ALSO flip immediately to the new
    // persona — the visible-on-top outgoing layer is what carries
    // the OLD persona's pixels during the dissolve.
    expect(heroStub).toHaveAttribute(
      "data-desktop-bg",
      "/personas/solo-builder/desktop.png",
    );
    expect(heroStub).toHaveAttribute(
      "data-outgoing-desktop-bg",
      "/personas/vibecoder/desktop.png",
    );
    expect(
      document.querySelector('[data-persona-id="solo-builder"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("public-chat-site-bg-image"),
    ).toHaveAttribute("src", "/personas/solo-builder/site.png");

    // The outgoing site bg overlay is mounted with the leaving
    // animation class so CSS can fade it from opacity 1 → 0 over
    // the next 550ms.
    const outgoingSiteBg = screen.getByTestId(
      "public-chat-site-bg-outgoing",
    );
    expect(outgoingSiteBg.className).toMatch(/Leaving/);
  });

  it("shares activeIndex between the right-edge tick rail and the bottom-left avatar dock — both directions", () => {
    // Single-piece-of-state contract: PublicChatView owns
    // `activeIndex` and forwards it to BOTH the right-edge rail
    // (via `aria-current`) AND the bottom-left avatar dock inside
    // MockAuraApp (via `activePersonaIndex`). The handler each
    // surface calls (`onActiveIndexChange` / `onPersonaSelect`) is
    // the same `setActiveIndex` setter, so a click on either
    // surface updates BOTH surfaces in the next render. This test
    // pins that loop by alternating clicks between the two
    // entry points.
    renderView();
    const heroStub = screen.getByTestId("mock-aura-app-stub");

    // Initial state: Vibecoder (index 0) is active in both
    // surfaces.
    expect(heroStub).toHaveAttribute("data-active-persona-index", "0");
    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");

    // Click the dock's Solo Builder avatar — the rail's
    // aria-current jumps to Solo Builder in the same render.
    fireEvent.click(
      screen.getByTestId("mock-aura-app-dock-select-solo-builder"),
    );
    expect(heroStub).toHaveAttribute("data-active-persona-index", "1");
    expect(tickFor("Solo Builder")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Vibecoder")).not.toHaveAttribute("aria-current");

    // Click a rail row — the dock's `activePersonaIndex` jumps to
    // Researcher (index 4) in the same render, proving the wiring
    // works in both directions.
    fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
    fireEvent.click(panelFor("Researcher"));
    expect(heroStub).toHaveAttribute("data-active-persona-index", "4");
    expect(tickFor("Researcher")).toHaveAttribute("aria-current", "true");
  });

  it("publishes per-persona foreground CSS vars on <html> for the public nav footer + tick rail to read", () => {
    const { unmount } = renderView();
    const root = document.documentElement;

    // Vibecoder is the default and pins the dark-mode text token
    // pair (`#e6e8eb` / `#c9c9cf`) because its `siteBackgroundColor`
    // (`#2a0258`) is theme-invariant — the foreground must be theme-
    // invariant too, otherwise the public nav collapses to near-
    // black on the deep-purple bg in light mode.
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe(
      "#e6e8eb",
    );
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "#c9c9cf",
    );

    const rail = screen.getByTestId("persona-tick-rail");
    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Solo Builder"));

    // Solo Builder ships with a near-black pair so the marketing
    // footer + idle ticks stay legible over its light dusty-blue
    // site background.
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe(
      "#0a0a0a",
    );
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "#1a1a1a",
    );

    // Switching to the NO_THEME persona (Researcher) clears both
    // properties so the default `--color-text-*` tokens take over on
    // the next paint. Researcher has no `siteBackgroundColor` of its
    // own — the page falls back to the global `--color-bg`, which IS
    // theme-driven, so the nav text must keep tracking the user's
    // theme here.
    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Researcher"));
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe("");
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "",
    );

    // Re-select Solo Builder so the cleanup path on unmount has
    // something to clear (otherwise the assertion below is a no-op).
    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Solo Builder"));
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe(
      "#0a0a0a",
    );

    unmount();
    // Leaving public mode (e.g. login -> authed shell) must not leak
    // contrast overrides into surfaces that don't mount the marketing
    // footer or tick rail.
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe("");
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "",
    );
  });
});

/**
 * Wheel-driven persona cycling: the entire public chat surface
 * acts as a vertical carousel — scrolling down advances to the
 * next persona (one step down the tick rail) and scrolling up
 * rewinds, wrapping past either end. There is intentionally NO
 * time-based throttle: every accepted wheel event advances exactly
 * one persona so the rail feels as snappy as the input device
 * (one wheel-notch = one persona; a fast trackpad flick streams
 * multiple persona changes in quick succession, which is the
 * desired "feels fast" behaviour).
 */
describe("PublicChatView wheel cycling", () => {
  function wheel(deltaY: number): void {
    fireEvent.wheel(screen.getByTestId("public-chat-view"), { deltaY });
  }

  it("advances to the next persona on a wheel-down gesture", () => {
    renderView();
    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");

    wheel(120);

    expect(tickFor("Solo Builder")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Vibecoder")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "1",
    );
  });

  it("wraps from the first persona to the last on a wheel-up gesture", () => {
    // Vibecoder (index 0) + wheel-up should land on Cypher Punk
    // (index PERSONAS.length - 1 = 5) rather than clamping at the
    // top — the user explicitly asked for cycling, not clamping.
    renderView();
    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");

    wheel(-120);

    expect(tickFor("Cypher Punk")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "5",
    );
  });

  it("wraps from the last persona back to the first on a wheel-down gesture", () => {
    // Companion to the wrap-backwards test above. Land on Cypher
    // Punk first via the panel (clicking is the established
    // user-driven path) and then wheel-down to prove the forward
    // wrap also works end-to-start.
    renderView();
    fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
    fireEvent.click(panelFor("Cypher Punk"));
    expect(tickFor("Cypher Punk")).toHaveAttribute("aria-current", "true");

    wheel(120);

    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "0",
    );
  });

  it("advances one persona per wheel event with no time-based throttle", () => {
    // The original implementation debounced consecutive wheel events
    // behind a 350ms cooldown. The current "feels fast" contract
    // intentionally has no cooldown: three wheel-downs in immediate
    // succession advance three personas (Vibecoder → Solo Builder →
    // Giga Brain → Coordinator), proving that nothing in the
    // handler swallows events that arrive on the same tick as a
    // prior accepted event.
    renderView();
    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");

    wheel(120);
    wheel(120);
    wheel(120);

    expect(tickFor("Coordinator")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Solo Builder")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "3",
    );
  });

  it("a wheel-down stream past the end wraps cleanly through the carousel boundary", () => {
    // The wrap arithmetic (`((prev + dir) % n + n) % n`) must hold
    // up across consecutive same-tick events, not just a single
    // boundary crossing. PERSONAS.length is 6, so seven wheel-down
    // events from index 0 land on index 1 (= 7 mod 6) — Solo
    // Builder — having passed through every persona exactly once
    // plus a re-entry into Vibecoder mid-stream.
    renderView();

    for (let i = 0; i < 7; i += 1) wheel(120);

    expect(tickFor("Solo Builder")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "1",
    );
  });

  it("ignores near-zero deltaY events (horizontal trackpad jitter)", () => {
    // Some browsers fold tiny horizontal trackpad noise into
    // `deltaY` as sub-pixel values; without the magnitude floor a
    // sideways two-finger swipe would occasionally flip the
    // persona. WHEEL_DELTA_THRESHOLD = 4 keeps those out.
    renderView();
    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");

    wheel(1);
    wheel(-2);
    wheel(3);

    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "0",
    );
  });
});
