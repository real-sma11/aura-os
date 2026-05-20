/**
 * Phase 4 vitest for `usePublicChatStore`. Pins the contract the
 * logged-out chat surface depends on:
 *
 * - localStorage round-trip (write → reset module → reload state).
 * - Schema forward-compat (v1 blob hydrates without exploding).
 * - Discriminated-union message variants (chat + media).
 * - `setTurnCount` / `createSession` / `deleteSession` mutate +
 *   persist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PublicAssistantMediaMessage,
  PublicSession,
} from "./public-chat-store";

vi.mock("../api/public-chat", () => ({
  setupPublicSession: vi.fn(),
}));

const STORAGE_KEY = "aura-public:state";

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  window.localStorage.clear();
});

async function importStore() {
  const mod = await import("./public-chat-store");
  return mod;
}

interface PersistedV1 {
  v: 1;
  guestToken: string | null;
  limit: number;
  turnCount: number;
  sessions: Record<string, unknown>;
  sessionOrder: string[];
}

describe("usePublicChatStore", () => {
  it("persists transcripts to localStorage and reloads them on a fresh import", async () => {
    const first = await importStore();
    const sessionId = first.usePublicChatStore.getState().createSession();
    const userMessageId = first.usePublicChatStore.getState().appendUserTurn(
      sessionId,
      "first message",
    );
    expect(typeof userMessageId).toBe("string");
    first.usePublicChatStore.getState().appendAssistantToken(
      sessionId,
      "assistant-1",
      "hello",
      "code",
    );
    first.usePublicChatStore.getState().commitAssistant(sessionId, "assistant-1");
    first.usePublicChatStore.getState().setTurnCount(2);

    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    vi.resetModules();
    const second = await importStore();
    const reloaded = second.usePublicChatStore.getState();
    expect(reloaded.turnCount).toBe(2);
    expect(reloaded.sessionOrder).toContain(sessionId);
    const session = reloaded.sessions[sessionId];
    expect(session).toBeDefined();
    expect(session?.turns).toHaveLength(2);
    expect(session?.turns[0].role).toBe("user");
    if (session?.turns[0].role === "user") {
      expect(session.turns[0].content).toBe("first message");
    }
    expect(session?.turns[1].role).toBe("assistant");
    if (session?.turns[1].role === "assistant" && session.turns[1].mode === "code") {
      expect(session.turns[1].content).toBe("hello");
    }
  });

  it("hydrates a v1-shape blob produced by Phase 2 (no `mode` discriminator)", async () => {
    const v1Blob: PersistedV1 = {
      v: 1,
      guestToken: "old-token",
      limit: 3,
      turnCount: 1,
      sessions: {
        "public-old": {
          id: "public-old",
          title: "Legacy chat",
          updatedAt: 1_700_000_000_000,
          turns: [
            { id: "user-old", role: "user", content: "legacy hi" },
            // v1 wrote assistant rows without a `mode` discriminator
            { id: "assistant-old", role: "assistant", content: "legacy reply" },
          ],
        },
      },
      sessionOrder: ["public-old"],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Blob));

    const { usePublicChatStore } = await importStore();
    const state = usePublicChatStore.getState();
    expect(state.guestToken).toBe("old-token");
    expect(state.turnCount).toBe(1);
    const session = state.sessions["public-old"];
    expect(session).toBeDefined();
    expect(session?.turns).toHaveLength(2);
    const assistantTurn = session?.turns[1];
    expect(assistantTurn?.role).toBe("assistant");
    if (assistantTurn?.role === "assistant" && assistantTurn.mode !== "image" &&
        assistantTurn.mode !== "video" && assistantTurn.mode !== "model3d") {
      // v1 forward-migration lands on the chat (`code`) variant.
      expect(assistantTurn.mode).toBe("code");
      expect(assistantTurn.content).toBe("legacy reply");
    }
  });

  it("appendUserTurn produces a user message variant with the new id", async () => {
    const { usePublicChatStore } = await importStore();
    const sessionId = usePublicChatStore.getState().createSession();
    const messageId = usePublicChatStore
      .getState()
      .appendUserTurn(sessionId, "my prompt");
    const session = usePublicChatStore.getState().sessions[sessionId];
    expect(session?.turns).toHaveLength(1);
    const turn = session?.turns[0];
    expect(turn?.id).toBe(messageId);
    expect(turn?.role).toBe("user");
    if (turn?.role === "user") {
      expect(turn.content).toBe("my prompt");
    }
  });

  it("appendAssistantToken accumulates deltas under the chat discriminated-union variant", async () => {
    const { usePublicChatStore } = await importStore();
    const sessionId = usePublicChatStore.getState().createSession();
    usePublicChatStore.getState().appendUserTurn(sessionId, "ping");
    usePublicChatStore
      .getState()
      .appendAssistantToken(sessionId, "asst-1", "hello ", "plan");
    usePublicChatStore
      .getState()
      .appendAssistantToken(sessionId, "asst-1", "world", "plan");
    usePublicChatStore.getState().commitAssistant(sessionId, "asst-1");

    const turns = usePublicChatStore.getState().sessions[sessionId]?.turns ?? [];
    expect(turns).toHaveLength(2);
    const last = turns[1];
    expect(last.role).toBe("assistant");
    if (last.role === "assistant" && (last.mode === "code" || last.mode === "plan")) {
      expect(last.mode).toBe("plan");
      expect(last.content).toBe("hello world");
    }
  });

  it("commitMedia produces image / video / model3d discriminated variants", async () => {
    const { usePublicChatStore } = await importStore();
    const sessionId = usePublicChatStore.getState().createSession();
    const variants: PublicAssistantMediaMessage[] = [
      {
        id: "asst-img",
        role: "assistant",
        mode: "image",
        url: "https://cdn.example.com/a.png",
        prompt: "image-prompt",
      },
      {
        id: "asst-video",
        role: "assistant",
        mode: "video",
        url: "https://cdn.example.com/a.mp4",
        prompt: "video-prompt",
      },
      {
        id: "asst-3d",
        role: "assistant",
        mode: "model3d",
        url: "https://cdn.example.com/a.glb",
        prompt: "3d-prompt",
      },
    ];
    for (const v of variants) {
      usePublicChatStore.getState().commitMedia(sessionId, v);
    }
    const turns =
      usePublicChatStore.getState().sessions[sessionId]?.turns ?? [];
    expect(turns).toHaveLength(3);
    expect(turns.map((t) => (t.role === "assistant" ? t.mode : null))).toEqual([
      "image",
      "video",
      "model3d",
    ]);
  });

  it("setTurnCount updates state and persists", async () => {
    const { usePublicChatStore } = await importStore();
    usePublicChatStore.getState().setTurnCount(2);
    expect(usePublicChatStore.getState().turnCount).toBe(2);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = raw ? (JSON.parse(raw) as { turnCount: number }) : null;
    expect(parsed?.turnCount).toBe(2);
  });

  it("setTurnCount clamps negative inputs to zero", async () => {
    const { usePublicChatStore } = await importStore();
    usePublicChatStore.getState().setTurnCount(-5);
    expect(usePublicChatStore.getState().turnCount).toBe(0);
  });

  it("createSession appends to sessionOrder newest-first", async () => {
    const { usePublicChatStore } = await importStore();
    const a = usePublicChatStore.getState().createSession();
    const b = usePublicChatStore.getState().createSession();
    const c = usePublicChatStore.getState().createSession();
    expect(usePublicChatStore.getState().sessionOrder).toEqual([c, b, a]);
  });

  it("deleteSession removes from both sessions and sessionOrder", async () => {
    const { usePublicChatStore } = await importStore();
    const a = usePublicChatStore.getState().createSession();
    const b = usePublicChatStore.getState().createSession();
    usePublicChatStore.getState().deleteSession(a);
    const state = usePublicChatStore.getState();
    expect(state.sessionOrder).toEqual([b]);
    expect(state.sessions[a]).toBeUndefined();
    expect(state.sessions[b]).toBeDefined();
  });

  it("selectShouldShowGate is true once turnCount hits the limit", async () => {
    const { usePublicChatStore, selectShouldShowGate } = await importStore();
    expect(selectShouldShowGate(usePublicChatStore.getState())).toBe(false);
    usePublicChatStore.getState().setTurnCount(3);
    expect(selectShouldShowGate(usePublicChatStore.getState())).toBe(true);
  });

  it("selectSession returns null for unknown ids", async () => {
    const { usePublicChatStore, selectSession } = await importStore();
    expect(selectSession(usePublicChatStore.getState(), "nope")).toBeNull();
    const id = usePublicChatStore.getState().createSession();
    const session = selectSession(
      usePublicChatStore.getState(),
      id,
    ) as PublicSession;
    expect(session.id).toBe(id);
  });

  it("ensureToken short-circuits when a token is already in state", async () => {
    const { usePublicChatStore } = await importStore();
    const api = await import("../api/public-chat");
    usePublicChatStore.setState({ guestToken: "cached-token" });
    const tok = await usePublicChatStore.getState().ensureToken();
    expect(tok).toBe("cached-token");
    expect(api.setupPublicSession).not.toHaveBeenCalled();
  });

  it("ensureToken calls setupPublicSession and updates state when token is missing", async () => {
    const { usePublicChatStore } = await importStore();
    const api = await import("../api/public-chat");
    (api.setupPublicSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      token: "fresh-token",
      turn_count: 1,
      limit: 3,
    });
    const tok = await usePublicChatStore.getState().ensureToken();
    expect(tok).toBe("fresh-token");
    const state = usePublicChatStore.getState();
    expect(state.guestToken).toBe("fresh-token");
    expect(state.turnCount).toBe(1);
    expect(state.limit).toBe(3);
  });
});
