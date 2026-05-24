import { buildDisplayEvents } from "./build-display-messages";
import type { SessionEvent, ChatContentBlock } from "../shared/types";

function makeMsg(overrides: Partial<SessionEvent> & { event_id: string; role: SessionEvent["role"] }): SessionEvent {
  return {
    agent_instance_id: "ai-1" as SessionEvent["agent_instance_id"],
    project_id: "p-1" as SessionEvent["project_id"],
    content: "",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildDisplayEvents", () => {
  it("filters out empty messages", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "user", content: "" }),
      makeMsg({ event_id: "2", role: "user", content: "hello" }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hello");
  });

  it("preserves messages with only whitespace content", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "user", content: "   " }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result).toHaveLength(0);
  });

  it("maps event_id to id", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "msg-42", role: "assistant", content: "hi" }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].id).toBe("msg-42");
  });

  it("maps text content blocks", () => {
    const blocks: ChatContentBlock[] = [
      { type: "text", text: "Hello world" },
    ];
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "hi", content_blocks: blocks }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].contentBlocks).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("maps image content blocks", () => {
    const blocks: ChatContentBlock[] = [
      { type: "image", media_type: "image/jpeg", data: "base64data" },
    ];
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "img", content_blocks: blocks }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].contentBlocks).toEqual([
      { type: "image", media_type: "image/jpeg", data: "base64data" },
    ]);
  });

  it("filters out tool_use and tool_result from display blocks", () => {
    const blocks: ChatContentBlock[] = [
      { type: "text", text: "hi" },
      { type: "tool_use", id: "t1", name: "read_file", input: {} },
      { type: "tool_result", tool_use_id: "t1", content: "file content" },
    ];
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "x", content_blocks: blocks }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].contentBlocks).toHaveLength(1);
    expect(result[0].contentBlocks![0].type).toBe("text");
  });

  it("extracts tool calls from content blocks", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
      { type: "tool_result", tool_use_id: "t1", content: "ok" },
    ];
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "done", content_blocks: blocks }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].toolCalls).toHaveLength(1);
    expect(result[0].toolCalls![0].name).toBe("read_file");
    expect(result[0].toolCalls![0].result).toBe("ok");
  });

  it("extracts artifact refs from content blocks", () => {
    const blocks: ChatContentBlock[] = [
      { type: "task_ref", task_id: "task-1", title: "My Task" },
      { type: "spec_ref", spec_id: "spec-1", title: "My Spec" },
    ];
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "refs", content_blocks: blocks }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].artifactRefs).toHaveLength(2);
    expect(result[0].artifactRefs![0]).toEqual({ kind: "task", id: "task-1", title: "My Task" });
    expect(result[0].artifactRefs![1]).toEqual({ kind: "spec", id: "spec-1", title: "My Spec" });
  });

  it("includes thinking text when present", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "resp", thinking: "Let me think..." }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].thinkingText).toBe("Let me think...");
  });

  it("omits thinking text when empty string", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "resp", thinking: "" }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].thinkingText).toBeUndefined();
  });

  it("includes thinking_duration_ms", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "r", thinking_duration_ms: 1500 }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].thinkingDurationMs).toBe(1500);
  });

  it("builds timeline only for assistant messages", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "user", content: "hi" }),
      makeMsg({ event_id: "2", role: "assistant", content: "hello" }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].timeline).toBeUndefined();
    expect(result[1].timeline).toBeDefined();
  });

  it("keeps messages with content_blocks but no content", () => {
    const blocks: ChatContentBlock[] = [{ type: "text", text: "block text" }];
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "", content_blocks: blocks }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result).toHaveLength(1);
  });

  it("keeps messages with thinking but no content", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "", thinking: "hmm" }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result).toHaveLength(1);
  });

  it("keeps interrupted assistant message with content_blocks but empty content", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
      { type: "tool_result", tool_use_id: "t1", content: "file contents" },
      { type: "text", text: "partial response" },
    ];
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "", content_blocks: blocks }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].toolCalls).toHaveLength(1);
    expect(result[0].contentBlocks).toHaveLength(1);
    expect(result[0].contentBlocks![0]).toEqual({ type: "text", text: "partial response" });
  });

  it("keeps assistant message with only thinking_duration_ms set", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "assistant", content: "", thinking_duration_ms: 1200 }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result).toHaveLength(1);
  });

  it("still filters empty user messages even with thinking_duration_ms", () => {
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "1", role: "user", content: "", thinking_duration_ms: 1200 }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result).toHaveLength(0);
  });

  it("threads from_agent_id through as fromAgentId on cross-agent user messages", () => {
    // The server-side `parse_user_message_event` only sets
    // `from_agent_id` on user_message rows that were injected by
    // another agent (A→B inbound or B→A async reply). The display
    // adapter must surface it verbatim under the camelCased
    // `fromAgentId` key so `MessageBubble` can render the
    // "↩ from <agent>" provenance badge. Without this pass-through
    // Barret's reply renders indistinguishably from a real human
    // prompt — the regression Fix A was added to close.
    const msgs: SessionEvent[] = [
      makeMsg({
        event_id: "msg-cross-agent",
        role: "user",
        content: "Hello back!",
        from_agent_id: "barret-agent-uuid",
      }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].fromAgentId).toBe("barret-agent-uuid");
  });

  it("leaves fromAgentId undefined on regular human-typed user messages", () => {
    // Negative pin: a regular user prompt has no `from_agent_id`
    // set, and the badge UI must stay off — defaulting to a
    // visible badge would mislabel every typed message.
    const msgs: SessionEvent[] = [
      makeMsg({ event_id: "u-1", role: "user", content: "hi" }),
    ];
    const result = buildDisplayEvents(msgs);
    expect(result[0].fromAgentId).toBeUndefined();
  });
});
