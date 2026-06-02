import { describe, it, expect } from "vitest";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { parseStreamKey } from "./parse-stream-key";
import { findPrecedingUserMessage } from "./find-preceding-user-message";

function msg(
  id: string,
  role: DisplaySessionEvent["role"],
  content: string,
): DisplaySessionEvent {
  return { id, role, content };
}

describe("parseStreamKey", () => {
  it("parses a project:agent:session key", () => {
    expect(parseStreamKey("p1:ai1:s1")).toEqual({
      projectId: "p1",
      agentInstanceId: "ai1",
      sessionId: "s1",
    });
  });

  it("treats the fresh-canvas placeholder as a null session", () => {
    expect(parseStreamKey("p1:ai1:fresh")).toEqual({
      projectId: "p1",
      agentInstanceId: "ai1",
      sessionId: null,
    });
  });

  it("returns null for malformed keys", () => {
    expect(parseStreamKey("p1:ai1")).toBeNull();
    expect(parseStreamKey("")).toBeNull();
  });
});

describe("findPrecedingUserMessage", () => {
  const messages: DisplaySessionEvent[] = [
    msg("u1", "user", "first question"),
    msg("a1", "assistant", "first answer"),
    msg("u2", "user", "second question"),
    msg("a2", "assistant", "second answer"),
  ];

  it("finds the nearest preceding user message", () => {
    expect(findPrecedingUserMessage(messages, "a2")).toBe("second question");
    expect(findPrecedingUserMessage(messages, "a1")).toBe("first question");
  });

  it("skips optimistic placeholder rows", () => {
    const withOptimistic: DisplaySessionEvent[] = [
      msg("u1", "user", "real prompt"),
      msg("temp-123", "user", "optimistic prompt"),
      msg("a1", "assistant", "answer"),
    ];
    expect(findPrecedingUserMessage(withOptimistic, "a1")).toBe("real prompt");
  });

  it("returns null when no usable prompt precedes the assistant", () => {
    expect(findPrecedingUserMessage(messages, "missing")).toBeNull();
    expect(
      findPrecedingUserMessage([msg("a1", "assistant", "answer")], "a1"),
    ).toBeNull();
  });
});
