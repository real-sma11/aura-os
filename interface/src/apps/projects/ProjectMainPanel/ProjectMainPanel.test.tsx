import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../../test/render";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { SIDEKICK_ACTIVE_TAB_KEY } from "../../../constants";

const mockUseTerminalTarget = vi.fn();

vi.mock("../../../hooks/use-terminal-target", () => ({
  useTerminalTarget: (args: unknown) => mockUseTerminalTarget(args),
}));

vi.mock("../../../stores/terminal-panel-store", () => ({
  useTerminalPanelStore: (selector: (state: { setTerminalTarget: () => void }) => unknown) =>
    selector({ setTerminalTarget: vi.fn() }),
}));

import { ProjectMainPanel } from "./ProjectMainPanel";

describe("ProjectMainPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: "loading",
    });
    window.localStorage.clear();
    useSidekickStore.setState({ activeTab: "terminal" });
  });

  it("resets the sidekick active tab to terminal on entry, overriding a stale persisted value", () => {
    window.localStorage.setItem(SIDEKICK_ACTIVE_TAB_KEY, "sessions");
    useSidekickStore.setState({ activeTab: "sessions" });

    render(<ProjectMainPanel />);

    expect(useSidekickStore.getState().activeTab).toBe("terminal");
    expect(window.localStorage.getItem(SIDEKICK_ACTIVE_TAB_KEY)).toBe("terminal");
  });

  it("does not re-force terminal on subsequent renders within the same mount", () => {
    const { rerender } = render(<ProjectMainPanel />);
    expect(useSidekickStore.getState().activeTab).toBe("terminal");

    useSidekickStore.getState().setActiveTab("sessions");
    expect(useSidekickStore.getState().activeTab).toBe("sessions");

    rerender(<ProjectMainPanel />);

    expect(useSidekickStore.getState().activeTab).toBe("sessions");
  });
});
