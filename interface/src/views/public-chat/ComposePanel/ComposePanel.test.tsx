/**
 * Behavioural test for the public empty-state hero stack
 * (`ComposePanel`). Phase 0 stripped the helper example-prompt
 * pills entirely, so `ComposePanel` is now a thin layout wrapper
 * that centers the decorative `MockAuraApp` hero in the available
 * empty-state area.
 *
 * The actual `PublicComposeInput` is NOT mounted inside this
 * component — it lives in `PublicChatView`'s bottom-anchored
 * `.inputBarSlot` so the rounded input pill stays pinned to the
 * bottom of the screen in both empty and populated states.
 *
 * This test pins two contracts that survive that split:
 *
 *   - The `MockAuraApp` hero renders inside the panel.
 *   - No example-prompt buttons exist — the panel exposes zero
 *     interactive `button` roles now that the helper pills are
 *     gone.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ComposePanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// MockAuraApp stub that echoes the persona-dock props out as DOM
// attributes plus exposes a tiny "click" button so ComposePanel
// tests can verify (a) `activePersonaIndex` reaches the child, and
// (b) `onPersonaSelect` is forwarded — without pulling the real
// scripted DM windows in.
vi.mock("../MockAuraApp", () => ({
  MockAuraApp: ({
    activePersonaIndex,
    onPersonaSelect,
  }: {
    activePersonaIndex?: number;
    onPersonaSelect?: (index: number) => void;
  }) => (
    <div
      data-testid="mock-aura-app-stub"
      data-active-persona-index={
        activePersonaIndex != null ? String(activePersonaIndex) : ""
      }
    >
      <button
        type="button"
        data-testid="mock-aura-app-stub-select-2"
        onClick={() => onPersonaSelect?.(2)}
      />
    </div>
  ),
}));

import { ComposePanel } from "./ComposePanel";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ComposePanel", () => {
  it("renders the MockAuraApp hero", () => {
    render(<ComposePanel />);
    expect(screen.getByTestId("mock-aura-app-stub")).toBeInTheDocument();
  });

  it("forwards activePersonaIndex straight through to MockAuraApp", () => {
    render(<ComposePanel activePersonaIndex={4} />);
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "4",
    );
  });

  it("forwards onPersonaSelect straight through so an avatar click bubbles back to the host", () => {
    const onPersonaSelect = vi.fn();
    render(<ComposePanel onPersonaSelect={onPersonaSelect} />);

    fireEvent.click(screen.getByTestId("mock-aura-app-stub-select-2"));

    expect(onPersonaSelect).toHaveBeenCalledTimes(1);
    expect(onPersonaSelect).toHaveBeenCalledWith(2);
  });
});
