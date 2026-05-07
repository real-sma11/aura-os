import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectAgentSwitcher } from "./ProjectAgentSwitcher";
import type { AgentInstance } from "../../../../shared/types";

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title ?? undefined}>
        {children}
      </div>
    ) : null,
}));

vi.mock("../../../../mobile/chat/MobileProjectAgentSwitcherSheet", () => ({
  MobileProjectAgentSwitcherSheet: ({
    onSwitchAgent,
  }: {
    onSwitchAgent: (id: string) => void;
  }) => (
    <button data-testid="mobile-sheet" onClick={() => onSwitchAgent("a-2")}>
      mobile-sheet
    </button>
  ),
}));

function makeAgent(overrides: Partial<AgentInstance>): AgentInstance {
  return {
    agent_instance_id: "ai-1",
    agent_id: "a-1",
    name: "Agent One",
    role: "",
    project_id: "p-1",
    ...overrides,
  } as AgentInstance;
}

describe("ProjectAgentSwitcher", () => {
  it("returns null when closed", () => {
    const { container } = render(
      <ProjectAgentSwitcher
        isOpen={false}
        isMobile={false}
        agents={[]}
        currentAgentInstanceId="ai-1"
        onClose={vi.fn()}
        onSwitchAgent={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the modal with one row per agent on desktop", () => {
    render(
      <ProjectAgentSwitcher
        isOpen
        isMobile={false}
        agents={[
          makeAgent({ agent_instance_id: "ai-1", name: "Alpha" }),
          makeAgent({ agent_instance_id: "ai-2", name: "Beta", role: "Coder" }),
        ]}
        currentAgentInstanceId="ai-1"
        onClose={vi.fn()}
        onSwitchAgent={vi.fn()}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Coder")).toBeInTheDocument();
  });

  it("disables and labels the current agent row", () => {
    render(
      <ProjectAgentSwitcher
        isOpen
        isMobile={false}
        agents={[makeAgent({ agent_instance_id: "ai-1", name: "Alpha" })]}
        currentAgentInstanceId="ai-1"
        onClose={vi.fn()}
        onSwitchAgent={vi.fn()}
      />,
    );
    const button = screen.getByLabelText("Alpha, current agent");
    expect(button).toBeDisabled();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("invokes onSwitchAgent when a non-current row is clicked", () => {
    const onSwitchAgent = vi.fn();
    render(
      <ProjectAgentSwitcher
        isOpen
        isMobile={false}
        agents={[
          makeAgent({ agent_instance_id: "ai-1", name: "Alpha" }),
          makeAgent({ agent_instance_id: "ai-2", name: "Beta" }),
        ]}
        currentAgentInstanceId="ai-1"
        onClose={vi.fn()}
        onSwitchAgent={onSwitchAgent}
      />,
    );
    fireEvent.click(screen.getByLabelText("Switch to Beta"));
    expect(onSwitchAgent).toHaveBeenCalledWith("ai-2");
  });

  it("delegates to the mobile sheet when isMobile is true", () => {
    const onSwitchAgent = vi.fn();
    render(
      <ProjectAgentSwitcher
        isOpen
        isMobile
        agents={[]}
        currentAgentInstanceId="ai-1"
        onClose={vi.fn()}
        onSwitchAgent={onSwitchAgent}
      />,
    );
    fireEvent.click(screen.getByTestId("mobile-sheet"));
    expect(onSwitchAgent).toHaveBeenCalledWith("a-2");
  });
});
