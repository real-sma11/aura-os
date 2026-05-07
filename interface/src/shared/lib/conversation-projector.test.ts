import { describe, expect, it } from "vitest";
import type { DisplaySessionEvent } from "../types/stream";
import { projectConversation } from "./conversation-projector";

function makeUser(id: string, content: string): DisplaySessionEvent {
  return { id, clientId: id, role: "user", content };
}

function makeAssistant(id: string, content: string): DisplaySessionEvent {
  return { id, clientId: id, role: "assistant", content };
}

describe("projectConversation", () => {
  it("returns history when the stream is empty", () => {
    const history = [makeUser("u1", "hi"), makeAssistant("a1", "hello")];
    expect(projectConversation(history, [], false)).toEqual(history);
  });

  it("returns the stream as-is when history is empty", () => {
    const stream = [makeUser("temp-1", "hi"), makeAssistant("stream-1", "...")];
    expect(projectConversation([], stream, false)).toEqual(stream);
  });

  it("drops stream events whose id matches a history event", () => {
    const history = [makeUser("u1", "hi"), makeAssistant("a1", "hello")];
    const stream = [
      makeUser("u1", "hi"),
      makeAssistant("a1", "hello"),
    ];
    expect(projectConversation(history, stream, false)).toEqual(history);
  });

  it("drops the optimistic temp- user when persisted history holds the same content", () => {
    const history = [makeUser("evt-user", "first prompt")];
    const stream = [makeUser("temp-1", "first prompt")];
    expect(projectConversation(history, stream, false)).toEqual(history);
  });

  it("appends live-only stream events after history", () => {
    const history = [makeUser("u1", "hi"), makeAssistant("a1", "hello")];
    const stream = [
      makeUser("u1", "hi"),
      makeUser("temp-2", "follow-up"),
      makeAssistant("stream-2", "..."),
    ];
    const result = projectConversation(history, stream, false);
    expect(result.map((m) => m.id)).toEqual(["u1", "a1", "temp-2", "stream-2"]);
  });

  it("keeps a repeated optimistic prompt when history's last user does not match", () => {
    const history = [
      makeUser("u-old", "the answer is 42"),
      makeAssistant("a-old", "noted"),
    ];
    const stream = [makeUser("temp-1", "the answer is 42")];
    const result = projectConversation(history, stream, false);
    expect(result.map((m) => m.id)).toEqual(["u-old", "a-old", "temp-1"]);
  });

  it("preserves the assistant placeholder appended after an optimistic user prompt", () => {
    const history = [
      makeUser("u-old", "earlier"),
      makeAssistant("a-old", "earlier reply"),
    ];
    const stream = [
      makeUser("temp-2", "follow-up"),
      makeAssistant("stream-2", ""),
    ];
    const result = projectConversation(history, stream, false);
    expect(result.map((m) => m.id)).toEqual([
      "u-old",
      "a-old",
      "temp-2",
      "stream-2",
    ]);
  });

  it("dedups the persisted user message via id even when content differs from stream temp-", () => {
    // Edge: server may normalize content (trim, etc.). Id-based dedup
    // wins when the persisted id is reused (matches `evt-user` in stream).
    const history = [makeUser("evt-user", "trimmed")];
    const stream = [makeUser("evt-user", "trimmed   ")];
    expect(projectConversation(history, stream, false)).toEqual(history);
  });
});
