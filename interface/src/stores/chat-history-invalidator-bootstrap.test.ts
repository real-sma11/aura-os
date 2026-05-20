import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  const stub = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: stub,
    });
  }
});

import type { AuraEvent, AuraEventOfType } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import { subscribers } from "./event-store/event-store";
import {
  agentHistoryKey,
  projectChatHistoryKey,
  sessionHistoryKey,
  useChatHistoryStore,
} from "./chat-history-store";
import {
  bootstrapChatHistoryInvalidator,
  chatHistoryKeysFromEvent,
  teardownChatHistoryInvalidator,
} from "./chat-history-invalidator-bootstrap";

function dispatch(event: AuraEvent): void {
  const s = subscribers.get(event.type);
  if (!s) return;
  for (const cb of s) (cb as (e: AuraEvent) => void)(event);
}

function seedReadyEntry(key: string): void {
  useChatHistoryStore.setState((state) => ({
    entries: {
      ...state.entries,
      [key]: {
        events: [],
        status: "ready",
        fetchedAt: Date.now(),
        error: null,
        lastMessageAt: "2026-05-15T00:00:00Z",
      },
    },
  }));
}

function makeUserMessage(overrides: {
  session_id?: string;
  agent_id?: string;
  project_id?: string;
  project_agent_id?: string | null;
}): AuraEventOfType<typeof EventType.UserMessage> {
  return {
    event_id: "evt-1",
    session_id: overrides.session_id ?? "",
    user_id: "u1",
    agent_id: overrides.agent_id ?? "",
    project_agent_id: overrides.project_agent_id ?? null,
    sender: "user",
    project_id: overrides.project_id ?? "",
    org_id: "",
    type: EventType.UserMessage,
    content: { text: "hi" },
    created_at: "2026-05-15T00:00:00Z",
  } as AuraEventOfType<typeof EventType.UserMessage>;
}

function makeAssistantEnd(overrides: {
  session_id?: string;
  agent_id?: string;
  project_id?: string;
  project_agent_id?: string | null;
}): AuraEventOfType<typeof EventType.AssistantMessageEnd> {
  return {
    event_id: "evt-2",
    session_id: overrides.session_id ?? "",
    user_id: "u1",
    agent_id: overrides.agent_id ?? "",
    project_agent_id: overrides.project_agent_id ?? null,
    sender: "agent",
    project_id: overrides.project_id ?? "",
    org_id: "",
    type: EventType.AssistantMessageEnd,
    content: { message_id: "m1" },
    created_at: "2026-05-15T00:00:00Z",
  } as AuraEventOfType<typeof EventType.AssistantMessageEnd>;
}

beforeEach(() => {
  subscribers.clear();
  useChatHistoryStore.setState({
    entries: {},
    previewLastMessages: {},
    pinnedKeys: new Set<string>(),
  });
  bootstrapChatHistoryInvalidator();
});

afterEach(() => {
  teardownChatHistoryInvalidator();
  subscribers.clear();
});

describe("chatHistoryKeysFromEvent: id → history key mapping", () => {
  it("returns agent key when only agent_id is present (standalone agent panel)", () => {
    const keys = chatHistoryKeysFromEvent(
      makeUserMessage({ agent_id: "agent-A" }),
    );
    expect(keys).toEqual([agentHistoryKey("agent-A")]);
  });

  it("returns project key when project_id + project_agent_id are present", () => {
    const keys = chatHistoryKeysFromEvent(
      makeUserMessage({
        project_id: "proj-1",
        project_agent_id: "instance-1",
      }),
    );
    expect(keys).toEqual([projectChatHistoryKey("proj-1", "instance-1")]);
  });

  it("returns project + session keys when session_id is present", () => {
    const keys = chatHistoryKeysFromEvent(
      makeUserMessage({
        project_id: "proj-1",
        project_agent_id: "instance-1",
        session_id: "sess-1",
      }),
    );
    expect(keys).toEqual([
      projectChatHistoryKey("proj-1", "instance-1"),
      sessionHistoryKey("proj-1", "instance-1", "sess-1"),
    ]);
  });

  it("returns all three when agent_id, project ids, and session id are all present", () => {
    const keys = chatHistoryKeysFromEvent(
      makeUserMessage({
        agent_id: "agent-A",
        project_id: "proj-1",
        project_agent_id: "instance-1",
        session_id: "sess-1",
      }),
    );
    expect(keys).toEqual([
      agentHistoryKey("agent-A"),
      projectChatHistoryKey("proj-1", "instance-1"),
      sessionHistoryKey("proj-1", "instance-1", "sess-1"),
    ]);
  });

  it("skips blank / null ids — empty session_id and null project_agent_id produce no keys", () => {
    const keys = chatHistoryKeysFromEvent(
      makeUserMessage({
        agent_id: "  ",
        session_id: "",
        project_agent_id: null,
        project_id: "",
      }),
    );
    expect(keys).toEqual([]);
  });
});

describe("bootstrap: WS chat events invalidate chat-history cache regardless of mounted panels", () => {
  it("UserMessage marks the agent's cached entry stale (fetchedAt -> 0)", () => {
    const key = agentHistoryKey("agent-B");
    seedReadyEntry(key);
    const beforeFetchedAt = useChatHistoryStore.getState().entries[key]
      .fetchedAt;
    expect(beforeFetchedAt).toBeGreaterThan(0);

    dispatch(makeUserMessage({ agent_id: "agent-B" }));

    const entry = useChatHistoryStore.getState().entries[key];
    expect(entry.fetchedAt).toBe(0);
  });

  it("AssistantMessageEnd marks the same key stale on the recipient panel", () => {
    const key = agentHistoryKey("agent-B");
    seedReadyEntry(key);
    expect(useChatHistoryStore.getState().entries[key].fetchedAt).toBeGreaterThan(0);

    dispatch(makeAssistantEnd({ agent_id: "agent-B" }));

    expect(useChatHistoryStore.getState().entries[key].fetchedAt).toBe(0);
  });

  it("invalidates the project + session keys together when project context is present", () => {
    const projKey = projectChatHistoryKey("proj-1", "instance-1");
    const sessKey = sessionHistoryKey("proj-1", "instance-1", "sess-1");
    seedReadyEntry(projKey);
    seedReadyEntry(sessKey);

    dispatch(
      makeUserMessage({
        project_id: "proj-1",
        project_agent_id: "instance-1",
        session_id: "sess-1",
      }),
    );

    expect(useChatHistoryStore.getState().entries[projKey].fetchedAt).toBe(0);
    expect(useChatHistoryStore.getState().entries[sessKey].fetchedAt).toBe(0);
  });

  it("does NOT touch unrelated cached entries", () => {
    const targetKey = agentHistoryKey("agent-B");
    const unrelatedKey = agentHistoryKey("agent-C");
    seedReadyEntry(targetKey);
    seedReadyEntry(unrelatedKey);
    const unrelatedFetchedAt = useChatHistoryStore.getState().entries[
      unrelatedKey
    ].fetchedAt;

    dispatch(makeUserMessage({ agent_id: "agent-B" }));

    expect(useChatHistoryStore.getState().entries[targetKey].fetchedAt).toBe(0);
    expect(useChatHistoryStore.getState().entries[unrelatedKey].fetchedAt).toBe(
      unrelatedFetchedAt,
    );
  });

  it("is a no-op when the event has no usable ids (no entries created, no errors)", () => {
    const beforeKeys = Object.keys(useChatHistoryStore.getState().entries);

    dispatch(
      makeUserMessage({
        agent_id: "",
        session_id: "",
        project_id: "",
        project_agent_id: null,
      }),
    );

    expect(Object.keys(useChatHistoryStore.getState().entries)).toEqual(
      beforeKeys,
    );
  });

  it("is a no-op when there is no cached entry for the matching key (invalidate is safe to call)", () => {
    expect(useChatHistoryStore.getState().entries).toEqual({});

    dispatch(makeUserMessage({ agent_id: "agent-never-cached" }));

    expect(useChatHistoryStore.getState().entries).toEqual({});
  });
});
