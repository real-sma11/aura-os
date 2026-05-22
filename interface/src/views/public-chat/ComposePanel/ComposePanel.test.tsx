/**
 * Behavioural test for the public empty-state hero stack
 * (`ComposePanel`). The compose input bar is NOT mounted inside
 * this component — it lives in `PublicChatView`'s
 * bottom-anchored `.inputBarSlot` so the rounded input pill stays
 * pinned to the bottom of the screen in both empty and populated
 * states. This test pins one contract that survives that split:
 *
 *  - Clicking an example-prompt pill forwards the representative
 *    prompt up to the parent via `onSelectExample` so the parent
 *    can pre-fill the floating input bar AND focus it (focus is
 *    the parent's responsibility now that the input bar lives one
 *    level up).
 *
 *  Mousedown's default focus-steal is also prevented at the
 *  callsite (so a click on the pill while the input bar is focused
 *  doesn't blur it mid-typing); we exercise that path implicitly
 *  by routing every assertion through `userEvent.click`, which
 *  fires mousedown before click.
 *
 *  Phase 5 dropped the mode-switching side effect from these pills:
 *  the public input no longer carries a mode selector, so the pills
 *  only pre-fill the textarea now.
 */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ComposePanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../MockAuraApp", () => ({
  MockAuraApp: ({ inputDock }: { inputDock: ReactNode }) => (
    <div data-testid="mock-aura-app-stub">{inputDock}</div>
  ),
}));

import { ComposePanel } from "./ComposePanel";

function renderPanel(onSelectExample: (prompt: string) => void = vi.fn()) {
  return render(<ComposePanel onSelectExample={onSelectExample} />);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ComposePanel example pills", () => {
  it("forwards the example's representative prompt to the parent via onSelectExample", async () => {
    const user = userEvent.setup();
    const onSelectExample = vi.fn();
    renderPanel(onSelectExample);

    await user.click(
      screen.getByRole("button", { name: /Research a topic/i }),
    );

    expect(onSelectExample).toHaveBeenCalledTimes(1);
    expect(onSelectExample.mock.calls[0][0]).toMatch(
      /solid-state batteries/i,
    );
  });

  it("renders all four canonical example pills", () => {
    renderPanel();
    const examples = screen.getByRole("group", { name: "Example prompts" });
    expect(examples).toBeInTheDocument();
    for (const label of [
      /Code an app/i,
      /Build a website/i,
      /Plan a trip/i,
      /Research a topic/i,
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
