import type { Dispatch, SetStateAction } from "react";
import { applySubagentStatus, registerSpawnedSubagent } from "./subagent-cards";
import type {
  DisplaySessionEvent,
  StreamRefs,
  StreamSetters,
  ToolCallEntry,
} from "../../shared/types/stream";
import type {
  SubagentSpawned,
  SubagentStatus,
} from "../../shared/types/harness-protocol";

function makeRefs(toolCalls: ToolCallEntry[]): StreamRefs {
  return {
    streamBuffer: { current: "" },
    thinkingBuffer: { current: "" },
    thinkingStart: { current: null },
    toolCalls: { current: toolCalls },
    raf: { current: null },
    flushTimeout: { current: null },
    displayedTextLength: { current: 0 },
    lastTextFlushAt: { current: 0 },
    thinkingRaf: { current: null },
    timeline: { current: [] },
    snapshottedToolCallIds: { current: new Set<string>() },
  };
}

interface Harness {
  refs: StreamRefs;
  setters: StreamSetters;
  getEvents: () => DisplaySessionEvent[];
}

function makeHarness(
  toolCalls: ToolCallEntry[],
  initialEvents: DisplaySessionEvent[] = [],
): Harness {
  const refs = makeRefs(toolCalls);
  let events = initialEvents;
  const setEvents: Dispatch<SetStateAction<DisplaySessionEvent[]>> = (update) => {
    events = typeof update === "function" ? update(events) : update;
  };
  const noop = vi.fn();
  const setters: StreamSetters = {
    setStreamingText: noop,
    setThinkingText: noop,
    setThinkingDurationMs: noop,
    setActiveToolCalls: vi.fn(),
    setEvents,
    setIsStreaming: noop,
    setIsWriting: noop,
    setProgressText: noop,
    setTimeline: noop,
    setGenerationState: noop,
    setGenerationPercent: noop,
    clearGeneration: noop,
  };
  return { refs, setters, getEvents: () => events };
}

function taskCall(id: string, overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return { id, name: "Task", input: {}, pending: true, ...overrides };
}

const spawn = (overrides: Partial<SubagentSpawned> = {}): SubagentSpawned => ({
  child_run_id: "child-run-123",
  parent_tool_use_id: "toolu_task_1",
  subagent_type: "explore",
  prompt: "explore the repo",
  ...overrides,
});

describe("registerSpawnedSubagent", () => {
  it("stamps the originating task card with run id, type, prompt, and running status", () => {
    const h = makeHarness([taskCall("toolu_task_1")]);
    registerSpawnedSubagent(h.refs, h.setters, spawn());

    const tc = h.refs.toolCalls.current[0];
    expect(tc.subagentRunId).toBe("child-run-123");
    expect(tc.subagentType).toBe("explore");
    expect(tc.subagentPrompt).toBe("explore the repo");
    expect(tc.subagentStatus).toBe("running");
  });

  it("does nothing when the spawn has no parent tool-use id", () => {
    const h = makeHarness([taskCall("toolu_task_1")]);
    registerSpawnedSubagent(h.refs, h.setters, spawn({ parent_tool_use_id: null }));

    expect(h.refs.toolCalls.current[0].subagentRunId).toBeUndefined();
  });

  it("does not clobber a type/prompt the card already carried", () => {
    const h = makeHarness([
      taskCall("toolu_task_1", {
        subagentType: "shell",
        subagentPrompt: "run the build",
      }),
    ]);
    registerSpawnedSubagent(h.refs, h.setters, spawn());

    const tc = h.refs.toolCalls.current[0];
    expect(tc.subagentType).toBe("shell");
    expect(tc.subagentPrompt).toBe("run the build");
    expect(tc.subagentRunId).toBe("child-run-123");
  });

  it("patches a matching card in an already-finalized events turn", () => {
    const event: DisplaySessionEvent = {
      id: "evt-1",
      role: "assistant",
      content: "",
      toolCalls: [taskCall("toolu_task_1", { pending: false })],
    };
    const h = makeHarness([], [event]);
    registerSpawnedSubagent(h.refs, h.setters, spawn());

    const patched = h.getEvents()[0].toolCalls?.[0];
    expect(patched?.subagentRunId).toBe("child-run-123");
    expect(patched?.subagentStatus).toBe("running");
  });
});

describe("applySubagentStatus", () => {
  function statusHarness(): Harness {
    const h = makeHarness([taskCall("toolu_task_1")]);
    registerSpawnedSubagent(h.refs, h.setters, spawn());
    return h;
  }

  const status = (overrides: Partial<SubagentStatus> = {}): SubagentStatus => ({
    child_run_id: "child-run-123",
    state: "completed",
    reason: null,
    ...overrides,
  });

  it("transitions running -> completed for the matching child run", () => {
    const h = statusHarness();
    applySubagentStatus(h.refs, h.setters, status({ state: "completed" }));
    expect(h.refs.toolCalls.current[0].subagentStatus).toBe("completed");
  });

  it("records a failure reason on a failed transition", () => {
    const h = statusHarness();
    applySubagentStatus(
      h.refs,
      h.setters,
      status({ state: "failed", reason: "boom" }),
    );
    const tc = h.refs.toolCalls.current[0];
    expect(tc.subagentStatus).toBe("failed");
    expect(tc.subagentReason).toBe("boom");
  });

  it("applies a rejected transition (e.g. depth/quota)", () => {
    const h = statusHarness();
    applySubagentStatus(
      h.refs,
      h.setters,
      status({ state: "rejected", reason: "max depth exceeded" }),
    );
    const tc = h.refs.toolCalls.current[0];
    expect(tc.subagentStatus).toBe("rejected");
    expect(tc.subagentReason).toBe("max depth exceeded");
  });

  it("preserves a previously-set reason when the new status omits one", () => {
    const h = statusHarness();
    applySubagentStatus(
      h.refs,
      h.setters,
      status({ state: "failed", reason: "first" }),
    );
    applySubagentStatus(h.refs, h.setters, status({ state: "failed", reason: null }));
    expect(h.refs.toolCalls.current[0].subagentReason).toBe("first");
  });

  it("ignores a status for an unknown child run id", () => {
    const h = statusHarness();
    applySubagentStatus(
      h.refs,
      h.setters,
      status({ child_run_id: "other-run", state: "failed" }),
    );
    expect(h.refs.toolCalls.current[0].subagentStatus).toBe("running");
  });
});
