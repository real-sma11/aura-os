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

import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

  it("swaps the desktop wallpaper and site background when Solo Builder is selected from the menu", () => {
    renderView();
    const rail = screen.getByTestId("persona-tick-rail");
    const heroStub = screen.getByTestId("mock-aura-app-stub");

    // Vibecoder is the default and has no theme overrides: the
    // wallpaper falls back to the video loop (empty data attr on
    // the stub) and the `.chatView` carries no inline background.
    expect(heroStub).toHaveAttribute("data-desktop-bg", "");

    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Solo Builder"));

    expect(heroStub).toHaveAttribute(
      "data-desktop-bg",
      "/personas/solo-builder/desktop.png",
    );

    // The active persona id is mirrored on the root for downstream
    // CSS hooks; the inline background is applied to the same
    // element via `style`.
    const chatView = document.querySelector(
      '[data-persona-id="solo-builder"]',
    );
    expect(chatView).not.toBeNull();
    const inline = (chatView as HTMLElement).style;
    expect(inline.backgroundColor).not.toBe("");
    expect(inline.backgroundImage).toContain(
      "/personas/solo-builder/site.png",
    );
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

    // Solo Builder ships with a hard dark pair so the marketing
    // footer + idle ticks stay legible over its light dusty-blue
    // site background.
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe(
      "#1a1a1a",
    );
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "#4a4a4a",
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
      "#1a1a1a",
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
