/**
 * Behavioural test for `PublicChatView`'s landing layout.
 *
 * The public surface is a pure marketing landing with the
 * decorative `MockAuraApp` hero, a right-edge `PersonaTickRail`
 * (state-driven open/close menu), and a single bottom-anchored
 * "Create your agent" CTA button. These tests pin that contract,
 * the persona-theme swap wiring, and guard against any of the
 * removed chat chrome accidentally reappearing.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Stub `MockAuraApp` so the test surfaces just the wallpaper-prop
// contract — the real component pulls in a video element and the
// scripted DM windows, neither of which the landing test needs to
// exercise. The stub echoes `desktopBackgroundUrl` into a data
// attribute so the persona-theme swap is observable.
vi.mock("../MockAuraApp", () => ({
  MockAuraApp: ({
    desktopBackgroundUrl,
  }: {
    desktopBackgroundUrl?: string | null;
  }) => (
    <div
      data-testid="mock-aura-app-stub"
      data-desktop-bg={desktopBackgroundUrl ?? ""}
    />
  ),
}));

import { PublicChatView } from "./PublicChatView";

function renderView() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
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

function renderViewWithProbe() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
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

describe("PublicChatView landing", () => {
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
    // Mirrors the destination used by the marketing nav's "Sign Up"
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

  it("does not render any chat input, transcript, or gate modal", () => {
    renderView();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Compose")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("keep-chatting-modal-stub"),
    ).not.toBeInTheDocument();
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

  it("swaps the decode-gated wallpaper and layered site background when Solo Builder is selected from the menu", async () => {
    renderView();
    const rail = screen.getByTestId("persona-tick-rail");
    const heroStub = screen.getByTestId("mock-aura-app-stub");

    // Vibecoder is the default landing theme: the mock window's
    // wallpaper is the curated cyberpunk portrait and the page
    // bg behind the window is the deep-purple gradient image
    // (painted onto a stacked `.siteBackground` layer rather than
    // inline on `.chatView`).
    expect(heroStub).toHaveAttribute(
      "data-desktop-bg",
      "/personas/vibecoder/desktop.png",
    );
    const initialSiteBg = screen.getByTestId("public-chat-site-bg");
    expect(initialSiteBg.style.backgroundImage).toContain(
      "/personas/vibecoder/site.png",
    );
    expect(initialSiteBg.style.backgroundColor).not.toBe("");

    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Solo Builder"));

    // `useDecodedPersonaIndex` resolves on the next microtask once
    // the stubbed `Image.decode()` promises settle, so flush a
    // microtask before reading the committed snapshot.
    await act(async () => {
      await Promise.resolve();
    });

    expect(heroStub).toHaveAttribute(
      "data-desktop-bg",
      "/personas/solo-builder/desktop.png",
    );
    expect(
      document.querySelector('[data-persona-id="solo-builder"]'),
    ).not.toBeNull();

    const committedSiteBg = screen.getByTestId("public-chat-site-bg");
    expect(committedSiteBg.style.backgroundImage).toContain(
      "/personas/solo-builder/site.png",
    );
    expect(committedSiteBg.style.backgroundColor).not.toBe("");
  });

  it("flips the active tick immediately on click while holding the bg/wallpaper commit until images decode", async () => {
    // Two-tier state contract: `activeIndex` drives the rail and
    // foreground vars synchronously so the click feels responsive;
    // `committedIndex` (which drives the bg layers + wallpaper) is
    // gated on `Image.decode()` so neither layer pops in mid-fade.
    renderView();
    const heroStub = screen.getByTestId("mock-aura-app-stub");
    const initialSiteBg = screen.getByTestId("public-chat-site-bg");
    expect(initialSiteBg.style.backgroundImage).toContain(
      "/personas/vibecoder/site.png",
    );

    // Hold the next decode so the gate observably blocks the commit.
    let releaseDecode: () => void = () => undefined;
    const decodeBlocker = new Promise<void>((resolve) => {
      releaseDecode = resolve;
    });
    const originalDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function gatedDecode(): Promise<void> {
      return decodeBlocker;
    };

    try {
      const rail = screen.getByTestId("persona-tick-rail");
      fireEvent.mouseEnter(rail);
      fireEvent.click(panelFor("Solo Builder"));

      // Tick + aria-current flip immediately (active state is
      // un-gated). Pump one microtask so React commits the
      // synchronous setState before we assert.
      await act(async () => {
        await Promise.resolve();
      });
      expect(tickFor("Solo Builder")).toHaveAttribute("aria-current", "true");

      // The committed bg + wallpaper, however, must still reflect
      // Vibecoder — the decode-gated commit is pending.
      expect(heroStub).toHaveAttribute(
        "data-desktop-bg",
        "/personas/vibecoder/desktop.png",
      );
      expect(
        document.querySelector('[data-persona-id="vibecoder"]'),
      ).not.toBeNull();
      expect(
        screen.getByTestId("public-chat-site-bg").style.backgroundImage,
      ).toContain("/personas/vibecoder/site.png");

      // Releasing the decode advances the committed index and the
      // bg/wallpaper layers swap to Solo Builder.
      await act(async () => {
        releaseDecode();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(heroStub).toHaveAttribute(
        "data-desktop-bg",
        "/personas/solo-builder/desktop.png",
      );
      expect(
        screen.getByTestId("public-chat-site-bg").style.backgroundImage,
      ).toContain("/personas/solo-builder/site.png");
    } finally {
      HTMLImageElement.prototype.decode = originalDecode;
    }
  });

  it("publishes per-persona foreground CSS vars on <html> for the marketing footer + tick rail to read", () => {
    const { unmount } = renderView();
    const root = document.documentElement;

    // Vibecoder is the default (NO_THEME): neither variable is set.
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe("");
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "",
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

    // Switching back to a NO_THEME persona clears both properties so
    // the default tokens take over on the next paint.
    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Vibecoder"));
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
