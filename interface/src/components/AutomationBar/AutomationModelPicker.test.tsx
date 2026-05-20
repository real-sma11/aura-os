import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reuse the same lightweight ModelPicker stub the AutomationBar test
// file uses so the menu can be opened by clicking the trigger.
vi.mock("../InputBarShell", async () => {
  const React = await import("react");
  return {
    ModelPicker: ({
      selectedLabel,
      renderMenu,
      isInteractive,
      triggerProps,
    }: {
      selectedLabel: string;
      renderMenu: (close: () => void) => React.ReactNode;
      isInteractive?: boolean;
      triggerProps?: Record<string, unknown>;
    }) => {
      const [open, setOpen] = React.useState(false);
      return (
        <div data-testid="automation-model-picker">
          <button
            type="button"
            data-testid="automation-model-trigger"
            disabled={isInteractive === false}
            aria-expanded={open}
            {...triggerProps}
            onClick={() => setOpen((v: boolean) => !v)}
          >
            {selectedLabel}
          </button>
          {open ? renderMenu(() => setOpen(false)) : null}
        </div>
      );
    },
    inputBarShellStyles: new Proxy({}, { get: (_t, prop) => String(prop) }),
  };
});

vi.mock("./AutomationBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { AutomationModelPicker } from "./AutomationModelPicker";
import { useAutomationLoopStore } from "../../stores/automation-loop-store";
import {
  AURA_MANAGED_CHAT_MODELS,
  AVAILABLE_MODELS,
} from "../../constants/models";
import type { ProjectId } from "../../shared/types";

const PROJECT = "proj-pick" as ProjectId;

beforeEach(() => {
  useAutomationLoopStore.getState().reset();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

describe("AutomationModelPicker", () => {
  it("renders only AURA_MANAGED_CHAT_MODELS in the dropdown (no image/3D/video models)", async () => {
    const user = userEvent.setup();
    render(<AutomationModelPicker projectId={PROJECT} disabled={false} />);

    await user.click(screen.getByTestId("automation-model-trigger"));

    // Every chat model surfaces …
    for (const m of AURA_MANAGED_CHAT_MODELS) {
      expect(
        document.querySelector(`[data-agent-model-id="${m.id}"]`),
      ).not.toBeNull();
    }
    // … and no non-chat model leaks in.
    const nonChat = AVAILABLE_MODELS.filter((m) => m.mode !== "chat");
    for (const m of nonChat) {
      expect(
        document.querySelector(`[data-agent-model-id="${m.id}"]`),
      ).toBeNull();
    }
  });

  it("clicking a menu item persists the pick via the store", async () => {
    const user = userEvent.setup();
    render(<AutomationModelPicker projectId={PROJECT} disabled={false} />);

    await user.click(screen.getByTestId("automation-model-trigger"));
    const target = document.querySelector(
      '[data-agent-model-id="aura-claude-opus-4-7"]',
    ) as HTMLElement;
    expect(target).not.toBeNull();
    await user.click(target);

    expect(useAutomationLoopStore.getState().getLoopModel(PROJECT)).toBe(
      "aura-claude-opus-4-7",
    );
  });

  it("disabled=true renders an inert trigger so the menu cannot open", async () => {
    const user = userEvent.setup();
    render(<AutomationModelPicker projectId={PROJECT} disabled={true} />);

    const trigger = screen.getByTestId("automation-model-trigger");
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    // Menu items are only rendered when the picker is open; clicking
    // a disabled trigger must not flip the open state.
    expect(
      document.querySelector('[data-agent-model-id]'),
    ).toBeNull();
  });

  describe("fallback chain (per-project automation pick > main-LLM global pick > adapter default)", () => {
    it("falls back to the adapter default when nothing has been picked anywhere", () => {
      render(<AutomationModelPicker projectId={PROJECT} disabled={false} />);
      // Sonnet 4.6 is the adapter default (first in AURA_MANAGED_CHAT_MODELS).
      expect(screen.getByTestId("automation-model-trigger")).toHaveTextContent(
        "Sonnet 4.6",
      );
    });

    it("falls back to the main-LLM global pick when no per-project automation pick exists", () => {
      // Simulate the user having picked Opus 4.7 in the chat input bar
      // somewhere (which writes the global key as a side effect of
      // `persistModel`). The automation picker MUST surface that
      // instead of the adapter default.
      localStorage.setItem(
        "aura-selected-model:default",
        "aura-claude-opus-4-7",
      );

      render(<AutomationModelPicker projectId={PROJECT} disabled={false} />);
      expect(screen.getByTestId("automation-model-trigger")).toHaveTextContent(
        "Opus 4.7",
      );
    });

    it("the per-project automation pick still wins over the main-LLM global pick", () => {
      // Both keys set: project-specific automation pick is GPT-5.5,
      // global main-LLM pick is Opus 4.7. The project-specific value
      // must win so loop picks stay decoupled from the chat input bar
      // once the user has explicitly picked here.
      localStorage.setItem(
        "aura-selected-model:default",
        "aura-claude-opus-4-7",
      );
      useAutomationLoopStore.getState().setLoopModel(PROJECT, "aura-gpt-5-5");

      render(<AutomationModelPicker projectId={PROJECT} disabled={false} />);
      expect(screen.getByTestId("automation-model-trigger")).toHaveTextContent(
        "GPT-5.5",
      );
    });
  });
});
