import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiClientError } from "../../../../shared/api/core"
import { AgentEnvironment } from "./AgentEnvironment"

const swarmApiMocks = vi.hoisted(() => ({
  getRemoteAgentState: vi.fn(),
  remoteAgentAction: vi.fn(),
  recoverRemoteAgent: vi.fn(),
}))

vi.mock("../../../../api/client", () => ({
  api: {
    swarm: {
      getRemoteAgentState: swarmApiMocks.getRemoteAgentState,
      remoteAgentAction: swarmApiMocks.remoteAgentAction,
      recoverRemoteAgent: swarmApiMocks.recoverRemoteAgent,
    },
  },
}))

const envInfoMock = vi.hoisted(() => ({
  data: null as null | {
    os: string
    architecture: string
    hostname: string
    ip: string
    cwd: string
  },
}))

vi.mock("../../../../hooks/use-environment-info", () => ({
  useEnvironmentInfo: () => ({ data: envInfoMock.data }),
}))

vi.mock("../../../../hooks/use-avatar-state", () => ({
  useAvatarState: () => ({ isLocal: false, status: "idle" }),
}))

const subscribeMock = vi.fn(() => vi.fn())

vi.mock("../../../../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: typeof subscribeMock }) => unknown) =>
    selector({ subscribe: subscribeMock }),
}))

describe("AgentEnvironment", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    envInfoMock.data = null
    swarmApiMocks.getRemoteAgentState.mockResolvedValue({
      state: "error",
      uptime_seconds: 0,
      active_sessions: 0,
      error_message: "Machine failed",
      agent_id: "a1",
    })
    swarmApiMocks.remoteAgentAction.mockResolvedValue({ agent_id: "a1", status: "stopped" })
    swarmApiMocks.recoverRemoteAgent.mockResolvedValue({
      agent_id: "a1",
      status: "running",
      previous_vm_id: "old-vm",
      vm_id: "vm-2",
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders the status card outside the trigger stacking context", async () => {
    const user = userEvent.setup()
    const { container } = render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(swarmApiMocks.getRemoteAgentState).toHaveBeenCalledWith("a1")
    })

    await user.click(screen.getByRole("button", { name: "Remote" }))

    const statusLabel = await screen.findByText("Status")
    expect(document.body).toContainElement(statusLabel)
    expect(container).not.toContainElement(statusLabel)
  })

  it("shows Recovery for errored remote machines and calls recover endpoint", async () => {
    const user = userEvent.setup()

    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(swarmApiMocks.getRemoteAgentState).toHaveBeenCalledWith("a1")
    })

    await user.click(screen.getByRole("button", { name: "Remote" }))
    await user.click(await screen.findByRole("button", { name: "Manage" }))

    const recoveryButton = await screen.findByRole("button", { name: "Recovery" })
    expect(recoveryButton).toHaveAttribute("data-variant", "danger")

    await user.click(recoveryButton)

    await waitFor(() => {
      expect(swarmApiMocks.recoverRemoteAgent).toHaveBeenCalledWith("a1")
    })
    expect(swarmApiMocks.remoteAgentAction).not.toHaveBeenCalled()
  })

  it("clears recovery notice when recovery returns running status", async () => {
    swarmApiMocks.recoverRemoteAgent.mockResolvedValueOnce({
      agent_id: "a1",
      status: "running",
      previous_vm_id: "old-vm",
      vm_id: "vm-new",
    })

    const user = userEvent.setup()

    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(swarmApiMocks.getRemoteAgentState).toHaveBeenCalledWith("a1")
    })

    await user.click(screen.getByRole("button", { name: "Remote" }))
    await user.click(await screen.findByRole("button", { name: "Manage" }))
    await user.click(await screen.findByRole("button", { name: "Recovery" }))

    await waitFor(() => {
      expect(swarmApiMocks.recoverRemoteAgent).toHaveBeenCalledWith("a1")
    })
    expect(
      screen.queryByText("Recovery completed. The machine is available again."),
    ).not.toBeInTheDocument()
  })

  it("shows error notice when recovery API call fails", async () => {
    swarmApiMocks.recoverRemoteAgent.mockRejectedValueOnce(
      new Error("new machine entered error state after provisioning"),
    )

    const user = userEvent.setup()

    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(swarmApiMocks.getRemoteAgentState).toHaveBeenCalledWith("a1")
    })

    await user.click(screen.getByRole("button", { name: "Remote" }))
    await user.click(await screen.findByRole("button", { name: "Manage" }))
    await user.click(await screen.findByRole("button", { name: "Recovery" }))

    await waitFor(() => {
      expect(
        screen.getByText("new machine entered error state after provisioning"),
      ).toBeInTheDocument()
    })
  })

  it("shows a visible message when remote state fetch returns 404", async () => {
    swarmApiMocks.getRemoteAgentState.mockRejectedValueOnce(
      new ApiClientError(404, {
        error: "Not Found",
        code: "not_found",
        details: null,
      }),
    )

    const user = userEvent.setup()

    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(swarmApiMocks.getRemoteAgentState).toHaveBeenCalledWith("a1")
    })

    await user.click(screen.getByRole("button", { name: "Remote" }))

    expect(
      await screen.findByText(
        "Remote machine state is unavailable. This agent may no longer have an attached remote machine.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("Error")).toBeInTheDocument()
  })

  it("subscribes to WS events for real-time recovery updates", async () => {
    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledWith(
        "remote_agent_state_changed",
        expect.any(Function),
      )
    })
  })

  it("shows the agent's workspace folder (not the server CWD) when workspacePath is provided", async () => {
    envInfoMock.data = {
      os: "windows",
      architecture: "x86_64",
      hostname: "host",
      ip: "192.168.1.180",
      cwd: "C:\\code\\aura-os",
    }

    const user = userEvent.setup()
    render(
      <AgentEnvironment
        machineType="local"
        workspacePath={"C:\\code\\my-project"}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Local" }))

    expect(await screen.findByText("Workspace Folder")).toBeInTheDocument()
    expect(screen.getByText("C:\\code\\my-project")).toBeInTheDocument()
    expect(screen.queryByText("C:\\code\\aura-os")).not.toBeInTheDocument()
    expect(screen.queryByText("File Path")).not.toBeInTheDocument()
  })

  it("falls back to the server CWD when no workspacePath is provided", async () => {
    envInfoMock.data = {
      os: "windows",
      architecture: "x86_64",
      hostname: "host",
      ip: "192.168.1.180",
      cwd: "C:\\code\\aura-os",
    }

    const user = userEvent.setup()
    render(<AgentEnvironment machineType="local" />)

    await user.click(screen.getByRole("button", { name: "Local" }))

    expect(await screen.findByText("Workspace Folder")).toBeInTheDocument()
    expect(screen.getByText("C:\\code\\aura-os")).toBeInTheDocument()
  })

  it("renders an inert placeholder when machineType is undefined so the slot keeps width", async () => {
    const user = userEvent.setup()
    const { container } = render(<AgentEnvironment machineType={undefined} agentId="a1" />)

    // Placeholder is hidden from accessibility and from clicks: the text exists
    // in the DOM (so the slot keeps width) but no role="button" is rendered.
    expect(screen.queryByRole("button", { name: "Remote" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Local" })).not.toBeInTheDocument()

    const placeholder = container.querySelector('[data-loading="true"]')
    expect(placeholder).not.toBeNull()
    expect(placeholder).toHaveTextContent("Remote")
    expect(placeholder).toHaveAttribute("aria-hidden", "true")

    // No swarm fetch should fire while we don't yet know the agent's machine type.
    expect(swarmApiMocks.getRemoteAgentState).not.toHaveBeenCalled()

    // Hovering and clicking the placeholder must not open the popover.
    await user.hover(placeholder as Element)
    await user.click(placeholder as Element)
    expect(screen.queryByText("Status")).not.toBeInTheDocument()
  })
})
