import { describe, expect, it } from "vitest";
import type { DisplaySessionEvent } from "../../shared/types/stream";
import { buildTaskCopyText } from "./task-copy-utils";

describe("buildTaskCopyText", () => {
  it("includes title heading and status line", () => {
    const text = buildTaskCopyText({
      title: "Refactor parser",
      status: "completed",
    });

    expect(text).toContain("# Refactor parser [completed]");
    expect(text).toContain("Status: completed");
  });

  it("falls back to a generic heading when no title is given", () => {
    const text = buildTaskCopyText({ title: "", status: "in_progress" });
    expect(text).toContain("# Task [in_progress]");
  });

  it("renders the failure reason and provider context for failed tasks", () => {
    const text = buildTaskCopyText({
      title: "Build cli",
      status: "failed",
      failureReason: "stream terminated",
      failureContext: {
        providerRequestId: "req_01",
        model: "claude-sonnet-4",
        sseErrorType: "api_error",
      },
    });

    expect(text).toContain("Failure reason: stream terminated");
    expect(text).toContain(
      "Provider context: req=req_01 · claude-sonnet-4 · api_error",
    );
  });

  it("renders file ops, build, test, and git step sections", () => {
    const text = buildTaskCopyText({
      title: "Wire endpoint",
      status: "completed",
      fileOps: [
        { op: "modify", path: "a.ts" },
        { op: "create", path: "b.ts" },
      ],
      buildSteps: [
        { kind: "passed", command: "cargo build", timestamp: 1 },
      ],
      testSteps: [
        {
          kind: "failed",
          command: "cargo test",
          tests: [
            { name: "test::parser", status: "failed", message: "boom" },
          ],
          timestamp: 2,
        },
      ],
      gitSteps: [
        {
          kind: "committed",
          commitSha: "abcdef1234567890",
          timestamp: 3,
        },
      ],
    });

    expect(text).toContain("## Files");
    expect(text).toContain("- modify: a.ts");
    expect(text).toContain("- create: b.ts");
    expect(text).toContain("## Build Verification");
    expect(text).toContain("- passed `cargo build`");
    expect(text).toContain("## Test Verification");
    expect(text).toContain("- failed `cargo test`");
    expect(text).toContain("- failed: test::parser — boom");
    expect(text).toContain("## Git Activity");
    expect(text).toContain("- committed abcdef1");
  });

  it("includes the streamed events under the Output section", () => {
    const events: DisplaySessionEvent[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "",
        timeline: [{ kind: "text", id: "t1", content: "Final answer chunk" }],
      },
    ];

    const text = buildTaskCopyText({
      title: "My task",
      status: "completed",
      events,
    });

    expect(text).toContain("## Output");
    expect(text).toContain("Final answer chunk");
  });

  it("appends in-flight live state to the Output section", () => {
    const text = buildTaskCopyText({
      title: "My task",
      status: "in_progress",
      events: [],
      liveState: {
        streamingText: "Live streaming chunk",
        thinkingText: "",
        activeToolCalls: [],
        timeline: [],
      },
    });

    expect(text).toContain("## Output");
    expect(text).toContain("Live streaming chunk");
  });

  it("uses fallbackText when no structured events or live state exist", () => {
    const text = buildTaskCopyText({
      title: "My task",
      status: "completed",
      fallbackText: "raw text body",
    });

    expect(text).toContain("## Output");
    expect(text).toContain("raw text body");
  });

  it("omits the Output section when nothing is available", () => {
    const text = buildTaskCopyText({
      title: "My task",
      status: "completed",
    });

    expect(text).not.toContain("## Output");
  });
});
