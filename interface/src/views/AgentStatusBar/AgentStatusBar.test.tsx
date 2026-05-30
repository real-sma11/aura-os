/**
 * Vitest for `AgentStatusBar`. Focuses on the connection-loss
 * affordance: when the realtime event socket is disconnected the
 * status bar must surface the same standard Report bug flow used by
 * the chat error surfaces, scoped to the currently selected agent.
 *
 * The data hook is mocked so the test drives `connected` directly,
 * and `ReportBugButton` is mocked to a thin spy so we can assert the
 * forwarded props without booting the diagnostics/consent path.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectId } from "../../shared/types";

const reportBugSpy = vi.fn();

vi.mock("../../components/ReportBugButton", () => ({
  ReportBugButton: (props: { agentId?: string; titleSuffix?: string }) => {
    reportBugSpy(props);
    return (
      <button type="button" aria-label="Report bug" data-agent-id={props.agentId ?? ""}>
        Report bug
      </button>
    );
  },
}));

const hookState = {
  connected: true,
  agents: [] as Array<{ agent_instance_id: string; name: string; status: string }>,
  selectedAgent: null as { agent_instance_id: string; name: string; status: string } | null,
  sessions: [] as unknown[],
  currentTaskTitle: null as string | null,
  dropdownOpen: false,
  setDropdownOpen: vi.fn(),
  dropdownRef: { current: null },
  sessionCount: 0,
  setSelectedAgentId: vi.fn(),
};

vi.mock("./useAgentStatusBarData", () => ({
  useAgentStatusBarData: () => hookState,
}));

import { AgentStatusBar } from "./AgentStatusBar";

beforeEach(() => {
  vi.clearAllMocks();
  hookState.connected = true;
  hookState.agents = [{ agent_instance_id: "agent-7", name: "Desk Helper", status: "idle" }];
  hookState.selectedAgent = { agent_instance_id: "agent-7", name: "Desk Helper", status: "idle" };
  hookState.sessions = [];
  hookState.currentTaskTitle = null;
  hookState.sessionCount = 0;
});

describe("AgentStatusBar", () => {
  it("does not show the Report bug flow while connected", () => {
    hookState.connected = true;
    render(<AgentStatusBar projectId={"p1" as ProjectId} />);

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report bug" })).not.toBeInTheDocument();
  });

  it("surfaces the standard Report bug flow scoped to the selected agent when disconnected", () => {
    hookState.connected = false;
    render(<AgentStatusBar projectId={"p1" as ProjectId} />);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    const reportButton = screen.getByRole("button", { name: "Report bug" });
    expect(reportButton).toBeInTheDocument();
    expect(reportButton).toHaveAttribute("data-agent-id", "agent-7");
    expect(reportBugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-7", titleSuffix: "connection lost" }),
    );
  });
});
