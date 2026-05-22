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

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ComposePanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../MockAuraApp", () => ({
  MockAuraApp: () => <div data-testid="mock-aura-app-stub" />,
}));

import { ComposePanel } from "./ComposePanel";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ComposePanel", () => {
  it("renders the MockAuraApp hero and no example-prompt buttons", () => {
    render(<ComposePanel />);
    expect(screen.getByTestId("mock-aura-app-stub")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
