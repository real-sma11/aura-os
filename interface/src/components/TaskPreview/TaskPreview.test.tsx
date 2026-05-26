import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Task, TaskId, ProjectId, SpecId, TaskStatus } from "../../shared/types";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, title, disabled, onClick, icon, style }: {
    children?: React.ReactNode; title?: string; disabled?: boolean;
    onClick?: () => void; icon?: React.ReactNode; style?: React.CSSProperties;
    variant?: string; size?: string; iconOnly?: boolean;
  }) => (
    <button title={title} disabled={disabled} onClick={onClick} style={style}>{icon}{children}</button>
  ),
  GroupCollapsible: ({ children, label, stats }: {
    children?: React.ReactNode; label: string; count?: number; defaultOpen?: boolean;
    className?: string; stats?: React.ReactNode;
  }) => (
    <div data-testid={`group-${label}`}>
      <div data-testid={`group-${label}-stats`}>{stats}</div>
      {label}
      {children}
    </div>
  ),
}));

const mockRunTask = vi.fn();
const mockRetryTask = vi.fn();
const mockRedoTask = vi.fn();
const mockListAgentInstances = vi.fn();
const mockGetSession = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    runTask: (...args: unknown[]) => mockRunTask(...args),
    retryTask: (...args: unknown[]) => mockRetryTask(...args),
    redoTask: (...args: unknown[]) => mockRedoTask(...args),
    listAgentInstances: (...args: unknown[]) => mockListAgentInstances(...args),
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
  isInsufficientCreditsError: () => false,
  dispatchInsufficientCredits: vi.fn(),
}));

const mockSidekickState = {
  pushPreview: vi.fn(),
  setActiveTab: vi.fn(),
};
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

const mockProjectContext = {
  project: { project_id: "proj-1" as ProjectId },
  setProject: vi.fn(),
  message: "",
  handleArchive: vi.fn(),
  navigateToExecution: vi.fn(),
  initialSpecs: [],
  initialTasks: [],
};
vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockProjectContext,
}));

const eventStoreMock = {
  connected: true,
  subscribe: vi.fn(() => vi.fn()),
  seedTaskOutput: vi.fn(),
  taskOutputs: {} as Record<string, unknown>,
};
vi.mock("../../stores/event-store/index", () => ({
  useEventStore: (sel: (s: typeof eventStoreMock) => unknown) => sel(eventStoreMock),
  useTaskOutput: () => ({ text: "", fileOps: [], buildSteps: [], testSteps: [], gitSteps: [] }),
}));

vi.mock("../../hooks/use-loop-active", () => ({
  useLoopActive: () => false,
}));

let mockLiveStatus: TaskStatus | null = null;
vi.mock("../../hooks/use-task-status", () => ({
  useTaskStatus: () => ({
    liveStatus: mockLiveStatus,
    liveSessionId: null,
    failReason: null,
    setLiveStatus: vi.fn(),
    setFailReason: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-task-agent-instances", () => ({
  useTaskAgentInstances: () => ({ agentInstance: null, completedByAgent: null }),
}));

vi.mock("../../hooks/use-task-output-hydration", () => ({
  useTaskOutputHydration: vi.fn(),
}));

vi.mock("../../hooks/use-task-stream", () => ({
  useTaskStream: () => ({ streamKey: "task:task-1" }),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useStreamEvents: () => [],
  useStreamingText: () => "",
  useThinkingText: () => "",
  useThinkingDurationMs: () => 0,
  useActiveToolCalls: () => [],
  useTimeline: () => [],
  useProgressText: () => "",
  useIsStreaming: () => false,
  useIsWriting: () => false,
}));

vi.mock("../VerificationStepItem", () => ({
  VerificationStepItem: () => <div data-testid="verification-step" />,
}));

vi.mock("../TaskMetaSection", () => ({
  TaskMetaSection: (props: Record<string, unknown>) => (
    <div data-testid="task-meta">
      <span data-testid="effective-status">{String(props.effectiveStatus)}</span>
      {props.failReason && <span data-testid="fail-reason">{String(props.failReason)}</span>}
      {props.onRetry && (
        <button onClick={props.onRetry as () => void} data-testid="retry-btn">
          Retry
        </button>
      )}
      {props.onRedo && (
        <button onClick={props.onRedo as () => void} data-testid="redo-btn">
          Re-do
        </button>
      )}
    </div>
  ),
}));

vi.mock("../TaskFilesSection", () => ({
  TaskFilesSection: ({ fileOps }: { fileOps: { op: string; path: string }[] }) => (
    <div data-testid="task-files">{fileOps.length} files</div>
  ),
}));

vi.mock("../TaskOutputPanel", () => ({
  ActiveTaskStream: ({ taskId }: { taskId: string }) => (
    <div data-testid="active-task-stream" data-task-id={taskId} />
  ),
  CompletedTaskOutput: ({
    taskId,
    status,
  }: {
    taskId: string;
    status: string;
  }) => (
    <div
      data-testid="completed-task-output"
      data-task-id={taskId}
      data-status={status}
    />
  ),
  CopyTaskOutputButton: ({ getCopyText }: { getCopyText: () => string }) => (
    <button data-testid="copy-task-output-btn" onClick={() => getCopyText()}>
      Copy
    </button>
  ),
  buildTaskCopyText: vi.fn(() => "copy-text"),
}));

vi.mock("../../shared/utils/format", () => ({
  toBullets: (s: string) => s,
  formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
}));
vi.mock("../../utils/derive-activity", () => ({
  deriveActivity: () => [],
  computeIterationStats: () => null,
}));

vi.mock("../Preview/Preview.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { TaskPreview } from "../TaskPreview";
import { RunTaskButton } from "../RunTaskButton";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "task-1" as TaskId,
    project_id: "proj-1" as ProjectId,
    spec_id: "spec-1" as SpecId,
    title: "Test task",
    description: "A test task",
    status: "ready" as TaskStatus,
    order_index: 0,
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: null,
    completed_by_agent_instance_id: null,
    session_id: null,
    execution_notes: "",
    files_changed: [],
    build_steps: [],
    test_steps: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  } as Task;
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/projects/proj-1/agents/agent-1"]}>
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLiveStatus = null;
});

describe("TaskPreview", () => {
  it("renders task meta and files sections", () => {
    renderWithRouter(<TaskPreview task={makeTask()} />);
    expect(screen.getByTestId("task-meta")).toBeInTheDocument();
    expect(screen.getByTestId("task-files")).toBeInTheDocument();
  });

  it("does not render an output row for tasks that have not run", () => {
    renderWithRouter(<TaskPreview task={makeTask({ status: "ready" as TaskStatus })} />);
    expect(screen.queryByTestId("active-task-stream")).not.toBeInTheDocument();
    expect(screen.queryByTestId("completed-task-output")).not.toBeInTheDocument();
  });

  it("renders ActiveTaskStream while the task is in progress", () => {
    mockLiveStatus = "in_progress" as TaskStatus;
    renderWithRouter(
      <TaskPreview task={makeTask({ status: "in_progress" as TaskStatus })} />,
    );
    expect(screen.getByTestId("active-task-stream")).toHaveAttribute(
      "data-task-id",
      "task-1",
    );
    expect(screen.queryByTestId("completed-task-output")).not.toBeInTheDocument();
  });

  it("renders CompletedTaskOutput for a done task so the run history persists", () => {
    mockLiveStatus = "done" as TaskStatus;
    renderWithRouter(
      <TaskPreview task={makeTask({ status: "done" as TaskStatus })} />,
    );
    const output = screen.getByTestId("completed-task-output");
    expect(output).toHaveAttribute("data-task-id", "task-1");
    expect(output).toHaveAttribute("data-status", "completed");
    expect(screen.queryByTestId("active-task-stream")).not.toBeInTheDocument();
  });

  it("renders CompletedTaskOutput for a failed task", () => {
    mockLiveStatus = "failed" as TaskStatus;
    renderWithRouter(
      <TaskPreview task={makeTask({ status: "failed" as TaskStatus })} />,
    );
    const output = screen.getByTestId("completed-task-output");
    expect(output).toHaveAttribute("data-status", "failed");
  });

  it("shows effective status as ready", () => {
    renderWithRouter(<TaskPreview task={makeTask({ status: "ready" as TaskStatus })} />);
    expect(screen.getByTestId("effective-status")).toHaveTextContent("ready");
  });

  it("shows files_changed count", () => {
    const task = makeTask({
      status: "done" as TaskStatus,
      files_changed: [
        { op: "modify", path: "a.ts" },
        { op: "create", path: "b.ts" },
      ],
    });
    renderWithRouter(<TaskPreview task={task} />);
    expect(screen.getByTestId("task-files")).toHaveTextContent("2 files");
  });

  it("renders retry button via TaskMetaSection", () => {
    renderWithRouter(<TaskPreview task={makeTask({ status: "failed" as TaskStatus })} />);
    expect(screen.getByTestId("retry-btn")).toBeInTheDocument();
  });

  it("wires a Re-do affordance through TaskMetaSection that calls redoTask + runTask", async () => {
    // The TaskMetaSection mock above renders a `redo-btn` whenever the
    // hook supplies an `onRedo` callback. Clicking it must drive the
    // same code path as the failed-Retry button: hit the dedicated
    // `redoTask` endpoint to flip `done -> ready` (and clear the
    // attempts counter), then immediately fire a one-shot `runTask`
    // so the harness picks the work up regardless of whether the
    // automation loop is currently running.
    const user = userEvent.setup();
    mockRedoTask.mockResolvedValue(undefined);
    mockRunTask.mockResolvedValue(undefined);
    mockLiveStatus = "done" as TaskStatus;
    renderWithRouter(<TaskPreview task={makeTask({ status: "done" as TaskStatus })} />);

    await user.click(screen.getByTestId("redo-btn"));

    await waitFor(() => {
      expect(mockRedoTask).toHaveBeenCalledWith("proj-1", "task-1");
    });
    await waitFor(() => {
      expect(mockRunTask).toHaveBeenCalledWith("proj-1", "task-1", "agent-1", null);
    });
  });

  it("renders the copy button in the Live Output header for active tasks", () => {
    mockLiveStatus = "in_progress" as TaskStatus;
    renderWithRouter(
      <TaskPreview task={makeTask({ status: "in_progress" as TaskStatus })} />,
    );
    const stats = screen.getByTestId("group-Live Output-stats");
    expect(stats).toContainElement(screen.getByTestId("copy-task-output-btn"));
  });

  it("renders the copy button in the Output header for terminal tasks", () => {
    mockLiveStatus = "done" as TaskStatus;
    renderWithRouter(
      <TaskPreview task={makeTask({ status: "done" as TaskStatus })} />,
    );
    const stats = screen.getByTestId("group-Output-stats");
    expect(stats).toContainElement(screen.getByTestId("copy-task-output-btn"));
  });

  it("does not render the copy button when there is no output panel", () => {
    renderWithRouter(<TaskPreview task={makeTask({ status: "ready" as TaskStatus })} />);
    expect(screen.queryByTestId("copy-task-output-btn")).not.toBeInTheDocument();
  });
});

describe("RunTaskButton", () => {
  it("renders run task button for ready tasks", () => {
    renderWithRouter(<RunTaskButton task={makeTask({ status: "ready" as TaskStatus })} />);
    expect(screen.getByTitle("Run task")).toBeInTheDocument();
  });

  it("calls api.runTask when clicked", async () => {
    const user = userEvent.setup();
    mockRunTask.mockResolvedValue(undefined);
    renderWithRouter(<RunTaskButton task={makeTask({ status: "ready" as TaskStatus })} />);

    await user.click(screen.getByTitle("Run task"));
    await waitFor(() => {
      expect(mockRunTask).toHaveBeenCalledWith("proj-1", "task-1", "agent-1", null);
    });
  });

  it("hides run button when task is done", () => {
    mockLiveStatus = "done" as TaskStatus;
    renderWithRouter(<RunTaskButton task={makeTask({ status: "done" as TaskStatus })} />);
    expect(screen.getByTitle("Run task")).toHaveStyle({ visibility: "hidden" });
  });
});
