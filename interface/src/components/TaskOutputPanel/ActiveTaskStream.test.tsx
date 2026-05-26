import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ToolCallEntry } from "../../shared/types/stream";

// --- Stream hook mocks. These are the only knobs the placeholder gate
//     depends on, so each test sets them via the `streamState` object.

interface StreamState {
  isStreaming: boolean;
  streamingText: string;
  thinkingText: string;
  activeToolCalls: ToolCallEntry[];
}

let streamState: StreamState = {
  isStreaming: true,
  streamingText: "",
  thinkingText: "",
  activeToolCalls: [],
};

vi.mock("../../hooks/use-task-stream", () => ({
  useTaskStream: () => ({ streamKey: "task:test-task" }),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useIsStreaming: () => streamState.isStreaming,
  useIsWriting: () => false,
  useStreamingText: () => streamState.streamingText,
  useThinkingText: () => streamState.thinkingText,
  useThinkingDurationMs: () => null,
  useActiveToolCalls: () => streamState.activeToolCalls,
  useTimeline: () => [],
  useProgressText: () => "",
  useStreamEvents: () => [],
}));

vi.mock("../../stores/event-store/index", () => ({
  useTaskOutput: () => ({
    text: "",
    fileOps: [],
    buildSteps: [],
    testSteps: [],
    gitSteps: [],
  }),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({ project: { project_id: "proj-1" } }),
}));

vi.mock("../../hooks/use-cooldown-status", () => ({
  useCooldownStatus: () => ({ paused: false }),
  renderCooldownMessage: () => "Cooling down…",
}));

// `LLMStreamOutput` is the heavy content renderer the component swaps
// in when `hasContent` is true. Replace it with a sentinel so we can
// distinguish "real content rendered" from "placeholder rendered".
vi.mock("../ChatOutput", () => ({
  LLMStreamOutput: () => <div data-testid="llm-stream-output" />,
}));

// Tighter stub for the per-task copy button so it doesn't pull
// hydration / event-store transitive deps into the test.
vi.mock("./CopyTaskOutputButton", () => ({
  CopyTaskOutputButton: () => null,
}));

vi.mock("./TaskHeaderContextUsage", () => ({
  TaskHeaderContextUsage: () => null,
}));

vi.mock("./TaskOutputPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ActiveTaskStream } from "./ActiveTaskStream";

function makeSyntheticTool(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "synthetic-transition-1",
    name: "transition_task",
    input: {},
    pending: false,
    synthetic: true,
    ...overrides,
  };
}

function makeRealTool(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "real-tool-1",
    name: "read_file",
    input: {},
    pending: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  streamState = {
    isStreaming: true,
    streamingText: "",
    thinkingText: "",
    activeToolCalls: [],
  };
});

describe("ActiveTaskStream", () => {
  it("renders the Waiting for output… placeholder when only synthetic tool calls are present", () => {
    // Reproduces the regression where the synthetic `transition_task`
    // lifecycle card emitted on `TaskStarted` flipped `hasContent` to
    // `true` immediately, hiding the cooking placeholder for the
    // entire window between TaskStarted and the first real delta.
    streamState.activeToolCalls = [makeSyntheticTool()];

    render(<ActiveTaskStream taskId="test-task" title="Test task" />);

    expect(screen.getByText("Waiting for output…")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-stream-output")).not.toBeInTheDocument();
  });

  it("hides the placeholder and renders LLMStreamOutput once a real tool call lands", () => {
    streamState.activeToolCalls = [makeSyntheticTool(), makeRealTool()];

    render(<ActiveTaskStream taskId="test-task" title="Test task" />);

    expect(screen.queryByText("Waiting for output…")).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-stream-output")).toBeInTheDocument();
  });

  it("still shows the placeholder when isStreaming is true but no text/thinking/real-tool content exists", () => {
    // Drops `isStreaming` from the `hasContent` gate: parent surfaces
    // already gate mounting on `entry.status === "active"`, so leaving
    // `isStreaming` in here previously masked the placeholder for the
    // entire active window.
    streamState.isStreaming = true;
    streamState.streamingText = "";
    streamState.thinkingText = "";
    streamState.activeToolCalls = [];

    render(<ActiveTaskStream taskId="test-task" title="Test task" />);

    expect(screen.getByText("Waiting for output…")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-stream-output")).not.toBeInTheDocument();
  });
});
