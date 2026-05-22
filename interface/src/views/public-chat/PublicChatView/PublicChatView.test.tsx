/**
 * Behavioural test for `PublicChatView`'s landing layout.
 *
 * The public surface is a pure marketing landing with the
 * decorative `MockAuraApp` hero, a right-edge `PersonaTickRail`,
 * and a single bottom-anchored "Create your agent" CTA button.
 * These tests pin that contract, the persona-theme swap wiring,
 * and guard against any of the removed chat chrome accidentally
 * reappearing.
 */

import { fireEvent, render, screen } from "@testing-library/react";
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

  it("renders the 6 persona ticks on the right rail with the Solo Builder slot", () => {
    renderView();
    const personas = [
      "Vibecoder",
      "Solo Builder",
      "Giga Brain",
      "Coordinator",
      "Researcher",
      "Cypher Punk",
    ];
    for (const name of personas) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByTestId("persona-tick-rail")).toBeInTheDocument();
  });

  it("marks the first persona tick active by default and shifts active on hover", () => {
    renderView();
    const vibecoder = screen.getByRole("button", { name: "Vibecoder" });
    const researcher = screen.getByRole("button", { name: "Researcher" });

    // First tick paints active on mount, every other tick paints idle.
    expect(vibecoder).toHaveAttribute("aria-current", "true");
    expect(vibecoder).toHaveAttribute("data-active", "true");
    expect(researcher).not.toHaveAttribute("aria-current");
    expect(researcher).toHaveAttribute("data-active", "false");

    // Hovering a different tick promotes it to active and demotes
    // the previously-active row. The panel and parent theme both
    // observe this via the shared `data-active` flag.
    fireEvent.mouseEnter(researcher);
    expect(researcher).toHaveAttribute("aria-current", "true");
    expect(researcher).toHaveAttribute("data-active", "true");
    expect(vibecoder).not.toHaveAttribute("aria-current");
    expect(vibecoder).toHaveAttribute("data-active", "false");
  });

  it("swaps the desktop wallpaper and site background when the Solo Builder tick activates", () => {
    renderView();
    const soloBuilderTick = screen.getByRole("button", { name: "Solo Builder" });
    const heroStub = screen.getByTestId("mock-aura-app-stub");

    // Vibecoder is the default and has no theme overrides: the
    // wallpaper falls back to the video loop (empty data attr on
    // the stub) and the `.chatView` carries no inline background.
    expect(heroStub).toHaveAttribute("data-desktop-bg", "");

    fireEvent.mouseEnter(soloBuilderTick);

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
});
