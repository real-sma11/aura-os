import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, title, disabled, onClick, icon }: {
    children?: React.ReactNode; title?: string; disabled?: boolean;
    onClick?: () => void; icon?: React.ReactNode; variant?: string;
    size?: string; iconOnly?: boolean;
  }) => (
    <button title={title} disabled={disabled} onClick={onClick}>{icon}{children}</button>
  ),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { size?: string; variant?: string; as?: string }) => (
    <span {...props}>{children}</span>
  ),
  ModalConfirm: ({ isOpen, onClose, onConfirm, title, message, confirmLabel, cancelLabel }: {
    isOpen: boolean; onClose: () => void; onConfirm: () => void;
    title: string; message: string; confirmLabel?: string; cancelLabel?: string;
    danger?: boolean;
  }) =>
    isOpen ? (
      <div data-testid="modal-confirm">
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onClose}>{cancelLabel ?? "Cancel"}</button>
        <button onClick={onConfirm}>{confirmLabel ?? "Confirm"}</button>
      </div>
    ) : null,
}));

const mockGetLoopStatus = vi.fn();
const mockStartLoop = vi.fn();
const mockPauseLoop = vi.fn();
const mockStopLoop = vi.fn();
const mockResumeLoop = vi.fn();
const mockListAgentInstances = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    getLoopStatus: (...args: unknown[]) => mockGetLoopStatus(...args),
    startLoop: (...args: unknown[]) => mockStartLoop(...args),
    pauseLoop: (...args: unknown[]) => mockPauseLoop(...args),
    stopLoop: (...args: unknown[]) => mockStopLoop(...args),
    resumeLoop: (...args: unknown[]) => mockResumeLoop(...args),
    listAgentInstances: (...args: unknown[]) => mockListAgentInstances(...args),
  },
  isInsufficientCreditsError: () => false,
  dispatchInsufficientCredits: vi.fn(),
}));

const subscribeMock = vi.fn((_type: string, _cb: (...args: unknown[]) => void) => vi.fn());

vi.mock("../../stores/event-store/index", () => {
  const store = {
    connected: true,
    subscribe: (...args: unknown[]) => subscribeMock(...args),
  };
  return {
    useEventStore: (selector: (s: typeof store) => unknown) => selector(store),
  };
});

vi.mock("../StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status">{status}</span>,
}));

vi.mock("./AutomationBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// The picker pulls in InputBarShell CSS through `inputBarShellStyles`
// — short-circuit it here so the test harness doesn't try to parse a
// real CSS module. Mock factory is hoisted, so we can't reference
// top-level imports; pull `useState` in via a relative require so
// the mocked picker can manage its own open/closed state.
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

import { AutomationBar } from "../AutomationBar";
import { useAutomationLoopStore } from "../../stores/automation-loop-store";
import type { ProjectId } from "../../shared/types";

function renderBar(projectId: ProjectId = "proj-1" as ProjectId) {
  return render(
    <MemoryRouter initialEntries={["/projects/proj-1/agents/agent-1"]}>
      <Routes>
        <Route
          path="/projects/:projectId/agents/:agentInstanceId"
          element={<AutomationBar projectId={projectId} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAutomationLoopStore.getState().reset();
  // The automation model selector falls back to localStorage when the
  // in-memory map is empty, so tests must clear both halves of the
  // persistence chain to start from a clean slate. Without this, a
  // model picked in one test leaks into the next via the per-project
  // localStorage key.
  try {
    localStorage.clear();
  } catch {
    // jsdom always supports localStorage, but stay defensive.
  }
  mockGetLoopStatus.mockResolvedValue({ active_agent_instances: [], paused: false });
  // The bar resolves the project's `Loop`-role instance on mount so
  // pause/resume/stop scope to it; default to a mature project that
  // already has one.
  mockListAgentInstances.mockResolvedValue([
    { agent_instance_id: "agent-1", instance_role: "chat" },
    { agent_instance_id: "loop-agent-1", instance_role: "loop" },
  ]);
});

describe("AutomationBar", () => {
  it("renders Automation label and idle status", async () => {
    renderBar();
    expect(screen.getByText("Automation")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });
  });

  it("fetches loop status on mount", () => {
    renderBar();
    expect(mockGetLoopStatus).toHaveBeenCalledWith("proj-1");
  });

  it("shows active status when agents are running", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
  });

  it("shows paused status", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: true });
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("paused");
    });
  });

  it("start button calls api.startLoop without an agent id so the backend resolves the Loop instance", async () => {
    const user = userEvent.setup();
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      agent_instance_id: "loop-agent-1",
    });
    // Seed an explicit AutomationBar model so we exercise the
    // thread-through path; without this the store would emit `null`
    // and the assertion below would fight a fallback path that
    // belongs in its own test.
    useAutomationLoopStore
      .getState()
      .setLoopModel("proj-1" as ProjectId, "aura-claude-opus-4-7");
    renderBar();
    // Wait for the on-mount listAgentInstances() to settle so the
    // hook has hydrated `boundLoopId` before we click.
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await user.click(screen.getByTitle("Start"));
    expect(mockStartLoop).toHaveBeenCalledWith(
      "proj-1",
      undefined,
      "aura-claude-opus-4-7",
    );
  });

  it("start passes a null model when no AutomationBar pick exists so the backend falls back to the Loop instance default", async () => {
    const user = userEvent.setup();
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      agent_instance_id: "loop-agent-1",
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await user.click(screen.getByTitle("Start"));
    expect(mockStartLoop).toHaveBeenCalledWith("proj-1", undefined, null);
  });

  it("model picker writes the selected model into the automation-loop store and the next Start uses it", async () => {
    const user = userEvent.setup();
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      agent_instance_id: "loop-agent-1",
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await user.click(screen.getByTestId("automation-model-trigger"));
    // Disambiguate from the trigger label (which echoes the active
    // selection) by querying inside the dropdown via the data-attr we
    // stamp on each menu item — both elements show "Opus 4.7" text.
    const opusOption = await waitFor(() => {
      const el = document.querySelector(
        '[data-agent-model-id="aura-claude-opus-4-7"]',
      );
      if (!el) throw new Error("Opus 4.7 menu item not yet rendered");
      return el as HTMLElement;
    });
    await user.click(opusOption);

    expect(
      useAutomationLoopStore.getState().getLoopModel("proj-1" as ProjectId),
    ).toBe("aura-claude-opus-4-7");

    await user.click(screen.getByTitle("Start"));
    expect(mockStartLoop).toHaveBeenCalledWith(
      "proj-1",
      undefined,
      "aura-claude-opus-4-7",
    );
  });

  it("disables the model picker once the loop is running so users can't pretend to swap mid-run", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
    expect(screen.getByTestId("automation-model-trigger")).toBeDisabled();
  });

  it("captures the resolved Loop agent id from startLoop and routes pause/stop through it", async () => {
    const user = userEvent.setup();
    // Project starts with no Loop instance — the backend creates one
    // on first start and returns its id, which the bar must reuse for
    // every subsequent control call.
    mockListAgentInstances.mockResolvedValue([
      { agent_instance_id: "agent-1", instance_role: "chat" },
    ]);
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-fresh"],
      agent_instance_id: "loop-agent-fresh",
    });
    mockPauseLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-fresh"],
      paused: true,
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalled());

    await user.click(screen.getByTitle("Start"));
    await waitFor(() =>
      expect(useAutomationLoopStore.getState().getLoopAgent("proj-1" as ProjectId)).toBe(
        "loop-agent-fresh",
      ),
    );

    await user.click(screen.getByTitle("Pause"));
    expect(mockPauseLoop).toHaveBeenCalledWith("proj-1", "loop-agent-fresh");
  });

  it("pause button targets the bound Loop instance rather than the URL chat agent", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    mockPauseLoop.mockResolvedValue(undefined);
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await waitFor(() => {
      expect(screen.getByTitle("Pause")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Pause"));
    expect(mockPauseLoop).toHaveBeenCalledWith("proj-1", "loop-agent-1");
  });

  it("stop button shows confirmation dialog", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Stop"));
    expect(screen.getByText("Stop Execution")).toBeInTheDocument();
    expect(screen.getByText(/Stop autonomous execution/)).toBeInTheDocument();
  });

  it("confirming stop calls api.stopLoop against the bound Loop instance", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    mockStopLoop.mockResolvedValue({ active_agent_instances: [] });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Stop"));
    const confirmBtn = screen.getByTestId("modal-confirm").querySelector("button:last-child")!;
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockStopLoop).toHaveBeenCalledWith("proj-1", "loop-agent-1");
    });
  });

  it("clears UI state and surfaces an error when stop fails", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValueOnce({ active_agent_instances: ["a1"], paused: false });
    // Reconciliation fetch after the failed stop returns no active agents so
    // we can assert the UI recovers to the Run state.
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: [], paused: false });
    mockStopLoop.mockRejectedValue(new Error("harness unreachable"));
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Stop"));
    const confirmBtn = screen.getByTestId("modal-confirm").querySelector("button:last-child")!;
    await user.click(confirmBtn);

    // Error surfaces through a ModalConfirm with the "Stop failed" title.
    await waitFor(() => {
      expect(screen.getByText("Stop failed")).toBeInTheDocument();
    });
    expect(screen.getByText("harness unreachable")).toBeInTheDocument();

    // Play button is re-enabled (UI was optimistically cleared + reconciled).
    await waitFor(() => {
      expect(screen.getByTitle("Start")).toBeEnabled();
    });
  });

  it("disables play when running and not paused", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Start")).toBeDisabled();
    });
  });

  it("enables play (Resume) when paused", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: true });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Resume")).toBeEnabled();
    });
  });

  it("resume routes through the bound Loop instance, not the URL chat agent", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: true,
    });
    mockResumeLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await waitFor(() => {
      expect(screen.getByTitle("Resume")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Resume"));
    expect(mockResumeLoop).toHaveBeenCalledWith("proj-1", "loop-agent-1");
    // The chat surface's `agent-1` must never be passed to a loop control call.
    expect(mockResumeLoop).not.toHaveBeenCalledWith("proj-1", "agent-1");
  });

  it("shows agent count when more than 1 agent", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1", "a2"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByText("2 agents")).toBeInTheDocument();
    });
  });

  it("does not show agent count for single agent", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
    expect(screen.queryByText(/agents/)).not.toBeInTheDocument();
  });
});
