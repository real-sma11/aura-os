import {
  isSubagentState,
  isTerminalSubagentState,
  parseSubagentExit,
  resolveSubagentState,
  subagentBadgeVariant,
  subagentStateLabel,
} from "./subagent";
import type { ToolCallEntry } from "../types/stream";

function taskEntry(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "toolu_task_1",
    name: "Task",
    input: {},
    pending: false,
    ...overrides,
  };
}

describe("isSubagentState", () => {
  it("accepts every known lifecycle state", () => {
    for (const state of [
      "running",
      "completed",
      "failed",
      "cancelled",
      "timeout",
      "rejected",
    ]) {
      expect(isSubagentState(state)).toBe(true);
    }
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isSubagentState("done")).toBe(false);
    expect(isSubagentState("")).toBe(false);
    expect(isSubagentState(undefined)).toBe(false);
    expect(isSubagentState(null)).toBe(false);
    expect(isSubagentState(42)).toBe(false);
  });
});

describe("parseSubagentExit", () => {
  it("parses a direct lifecycle state from the `exit` field", () => {
    expect(parseSubagentExit('{"exit":"completed"}')).toBe("completed");
    expect(parseSubagentExit('{"exit":"failed"}')).toBe("failed");
    expect(parseSubagentExit('{"exit":"timeout"}')).toBe("timeout");
    expect(parseSubagentExit('{"exit":"rejected"}')).toBe("rejected");
  });

  it("reads from `state` / `status` fallback keys", () => {
    expect(parseSubagentExit('{"state":"cancelled"}')).toBe("cancelled");
    expect(parseSubagentExit('{"status":"running"}')).toBe("running");
  });

  it("maps common success/error synonyms onto canonical states", () => {
    expect(parseSubagentExit('{"exit":"ok"}')).toBe("completed");
    expect(parseSubagentExit('{"exit":"SUCCESS"}')).toBe("completed");
    expect(parseSubagentExit('{"exit":"succeeded"}')).toBe("completed");
    expect(parseSubagentExit('{"exit":"done"}')).toBe("completed");
    expect(parseSubagentExit('{"exit":"error"}')).toBe("failed");
    expect(parseSubagentExit('{"exit":"errored"}')).toBe("failed");
  });

  it("returns null defensively for unparseable or unrecognized bodies", () => {
    expect(parseSubagentExit("not json")).toBeNull();
    expect(parseSubagentExit("null")).toBeNull();
    expect(parseSubagentExit('"just a string"')).toBeNull();
    expect(parseSubagentExit("[1,2,3]")).toBeNull();
    expect(parseSubagentExit('{"exit":123}')).toBeNull();
    expect(parseSubagentExit('{"exit":"weird"}')).toBeNull();
    expect(parseSubagentExit("{}")).toBeNull();
  });
});

describe("resolveSubagentState", () => {
  it("prefers the live subagent status above everything else", () => {
    const entry = taskEntry({
      subagentStatus: "rejected",
      result: '{"exit":"completed"}',
      isError: true,
      pending: true,
    });
    expect(resolveSubagentState(entry)).toBe("rejected");
  });

  it("falls back to a parsed tool result when no live status is set", () => {
    expect(resolveSubagentState(taskEntry({ result: '{"exit":"timeout"}' }))).toBe(
      "timeout",
    );
  });

  it("treats an errored tool call as failed when nothing else matches", () => {
    expect(resolveSubagentState(taskEntry({ isError: true }))).toBe("failed");
  });

  it("treats a still-pending tool call as running", () => {
    expect(resolveSubagentState(taskEntry({ pending: true }))).toBe("running");
  });

  it("defaults to completed for a finished card with no signals", () => {
    expect(resolveSubagentState(taskEntry())).toBe("completed");
  });
});

describe("subagentBadgeVariant", () => {
  it("maps each state onto a ZUI badge variant", () => {
    expect(subagentBadgeVariant("running")).toBe("running");
    expect(subagentBadgeVariant("failed")).toBe("error");
    expect(subagentBadgeVariant("timeout")).toBe("error");
    expect(subagentBadgeVariant("rejected")).toBe("error");
    expect(subagentBadgeVariant("completed")).toBe("stopped");
    expect(subagentBadgeVariant("cancelled")).toBe("stopped");
  });
});

describe("subagentStateLabel", () => {
  it("renders a human-readable label for each state", () => {
    expect(subagentStateLabel("running")).toBe("Running");
    expect(subagentStateLabel("completed")).toBe("Completed");
    expect(subagentStateLabel("failed")).toBe("Failed");
    expect(subagentStateLabel("cancelled")).toBe("Cancelled");
    expect(subagentStateLabel("timeout")).toBe("Timed out");
    expect(subagentStateLabel("rejected")).toBe("Rejected");
  });
});

describe("isTerminalSubagentState", () => {
  it("only running is non-terminal", () => {
    expect(isTerminalSubagentState("running")).toBe(false);
    expect(isTerminalSubagentState("completed")).toBe(true);
    expect(isTerminalSubagentState("failed")).toBe(true);
    expect(isTerminalSubagentState("rejected")).toBe(true);
  });
});
