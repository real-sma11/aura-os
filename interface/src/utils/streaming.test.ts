import { describe, it, expect } from "vitest";
import { getStreamingPhaseLabel } from "./streaming";
import type { ToolCallEntry } from "../shared/types/stream";
import { TOOL_PHASE_LABELS } from "../constants/tools";

function tool(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "tc1",
    name: "run_command",
    input: {},
    pending: false,
    ...overrides,
  };
}

describe("getStreamingPhaseLabel", () => {
  it("keeps the Cooking label while text is actively writing so the shimmer stays visible", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "hello",
        toolCalls: [],
        isWriting: true,
      }),
    ).toBe("Cooking...");
  });

  it("returns Cooking when streaming with settled text and no other phase", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "hello",
        toolCalls: [],
        isWriting: false,
      }),
    ).toBe("Cooking...");
  });

  it("returns Queued... when the partition is waiting behind another turn", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "",
        toolCalls: [],
        progressText: "queued",
      }),
    ).toBe("Queued...");
  });

  it("returns Thinking when only thinking has content", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "",
        thinkingText: "...",
        toolCalls: [],
      }),
    ).toBe("Thinking...");
  });

  it("returns the tool phase label when a pending tool dominates", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "",
        toolCalls: [tool({ pending: true, name: "read_file" })],
      }),
    ).toBeTruthy();
  });

  it("returns 'Putting it all together...' after tools have completed with no pending text", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "",
        toolCalls: [tool({ pending: false })],
      }),
    ).toBe("Putting it all together...");
  });

  it("keeps the Cooking label when only synthetic transition_task tool calls are in flight", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "",
        toolCalls: [
          tool({
            id: "synthetic-transition-1",
            name: "transition_task",
            synthetic: true,
            pending: false,
          }),
        ],
      }),
    ).toBe("Cooking...");
  });

  it("returns the real pending tool's phase label even when a synthetic transition is present", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "",
        toolCalls: [
          tool({
            id: "synthetic-transition-1",
            name: "transition_task",
            synthetic: true,
            pending: false,
          }),
          tool({ id: "real-1", name: "read_file", pending: true }),
        ],
      }),
    ).toBe(TOOL_PHASE_LABELS.read_file ?? "Working...");
  });

  it("returns 'Putting it all together...' when a resolved real tool sits next to a synthetic transition", () => {
    expect(
      getStreamingPhaseLabel({
        streamingText: "",
        toolCalls: [
          tool({
            id: "synthetic-transition-1",
            name: "transition_task",
            synthetic: true,
            pending: false,
          }),
          tool({ id: "real-1", name: "read_file", pending: false }),
        ],
      }),
    ).toBe("Putting it all together...");
  });
});
