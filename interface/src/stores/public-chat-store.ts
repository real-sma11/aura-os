/**
 * Zustand store powering the logged-out chat surface.
 *
 * The whole transcript lives in `localStorage["aura-public:state"]`
 * — the server never persists guest messages. The schema is
 * versioned (`SCHEMA_VERSION`) so future field changes can migrate
 * cleanly rather than blowing away every visitor's history on
 * deploy.
 *
 * The 3-turn gate is derived from `turnCount`; the modal can never
 * be dismissed so no separate "show" / "dismissed" latch is needed.
 */

import { create } from "zustand";
import { setupPublicSession } from "../api/public-chat";

/** Modality. Code + Plan land in Phase 2; the three media modes
 *  arrive in Phase 3 and the discriminated union below is already
 *  open to extension at that point. */
export type PublicMode = "code" | "plan" | "image" | "video" | "model3d";

/** One discriminated-union message in a public transcript. Phase 2
 *  emits only the `user` and chat-mode `assistant` variants; the
 *  media variants are reserved for Phase 3. */
export type PublicMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; mode: "code" | "plan"; content: string };

/** One client-side public session. */
export interface PublicSession {
  id: string;
  title: string;
  updatedAt: number;
  turns: PublicMessage[];
}

interface PublicChatState {
  guestToken: string | null;
  limit: number;
  turnCount: number;
  sessions: Record<string, PublicSession>;
  /** Newest-first order. */
  sessionOrder: string[];
  hasHydrated: boolean;
  /** True while a `setupPublicSession()` round-trip is in flight; we
   *  use this to make `ensureToken()` idempotent under concurrent
   *  mount calls. */
  setupInFlight: boolean;
}

interface PublicChatActions {
  ensureToken: () => Promise<string>;
  createSession: () => string;
  deleteSession: (sessionId: string) => void;
  appendUserTurn: (sessionId: string, content: string) => string;
  appendAssistantToken: (sessionId: string, messageId: string, deltaText: string) => void;
  commitAssistant: (sessionId: string, messageId: string) => void;
  setTurnCount: (next: number) => void;
}

type PublicChatStore = PublicChatState & PublicChatActions;

const STORAGE_KEY = "aura-public:state";
const SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 3;

interface PersistedV1 {
  v: 1;
  guestToken: string | null;
  limit: number;
  turnCount: number;
  sessions: Record<string, PublicSession>;
  sessionOrder: string[];
}

function loadPersisted(): Partial<PublicChatState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedV1(parsed)) return {};
    return {
      guestToken: parsed.guestToken,
      limit: parsed.limit,
      turnCount: parsed.turnCount,
      sessions: parsed.sessions,
      sessionOrder: parsed.sessionOrder,
    };
  } catch {
    return {};
  }
}

function persist(state: PublicChatState): void {
  if (typeof window === "undefined") return;
  const payload: PersistedV1 = {
    v: SCHEMA_VERSION,
    guestToken: state.guestToken,
    limit: state.limit,
    turnCount: state.turnCount,
    sessions: state.sessions,
    sessionOrder: state.sessionOrder,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — drop silently. The store stays usable
    // in-memory, the transcript just won't survive a reload.
  }
}

function isPersistedV1(value: unknown): value is PersistedV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === SCHEMA_VERSION &&
    (v.guestToken === null || typeof v.guestToken === "string") &&
    typeof v.limit === "number" &&
    typeof v.turnCount === "number" &&
    typeof v.sessions === "object" &&
    v.sessions !== null &&
    Array.isArray(v.sessionOrder)
  );
}

function randomId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

const initialPersisted = loadPersisted();

const initialState: PublicChatState = {
  guestToken: initialPersisted.guestToken ?? null,
  limit: initialPersisted.limit ?? DEFAULT_LIMIT,
  turnCount: initialPersisted.turnCount ?? 0,
  sessions: initialPersisted.sessions ?? {},
  sessionOrder: initialPersisted.sessionOrder ?? [],
  hasHydrated: true,
  setupInFlight: false,
};

function persistFromGet(get: () => PublicChatStore): void {
  persist(get());
}

export const usePublicChatStore = create<PublicChatStore>((set, get) => ({
  ...initialState,
  ensureToken: async () => {
    const existing = get().guestToken;
    if (existing) return existing;
    if (get().setupInFlight) {
      // Spin-wait briefly for the in-flight setup to settle. Simpler
      // than juggling a shared promise reference and covers the only
      // realistic race (two component effects firing in the same
      // commit phase).
      for (let i = 0; i < 50; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
        const tok = get().guestToken;
        if (tok) return tok;
      }
    }
    set({ setupInFlight: true });
    try {
      const response = await setupPublicSession();
      set({
        guestToken: response.token,
        turnCount: response.turn_count,
        limit: response.limit,
      });
      persistFromGet(get);
      return response.token;
    } finally {
      set({ setupInFlight: false });
    }
  },
  createSession: () => {
    const id = randomId("public");
    const session: PublicSession = {
      id,
      title: "New chat",
      updatedAt: Date.now(),
      turns: [],
    };
    set((s) => ({
      sessions: { ...s.sessions, [id]: session },
      sessionOrder: [id, ...s.sessionOrder.filter((existing) => existing !== id)],
    }));
    persistFromGet(get);
    return id;
  },
  deleteSession: (sessionId) => {
    set((s) => {
      const nextSessions = { ...s.sessions };
      delete nextSessions[sessionId];
      return {
        sessions: nextSessions,
        sessionOrder: s.sessionOrder.filter((id) => id !== sessionId),
      };
    });
    persistFromGet(get);
  },
  appendUserTurn: (sessionId, content) => {
    const messageId = randomId("user");
    set((s) => {
      const existing = s.sessions[sessionId];
      const sessionExists = !!existing;
      const session: PublicSession = existing ?? {
        id: sessionId,
        title: "New chat",
        updatedAt: Date.now(),
        turns: [],
      };
      const turns: PublicMessage[] = [
        ...session.turns,
        { id: messageId, role: "user", content },
      ];
      const title =
        session.turns.length === 0 ? deriveTitle(content) : session.title;
      const nextSession: PublicSession = {
        ...session,
        turns,
        title,
        updatedAt: Date.now(),
      };
      const nextOrder = sessionExists
        ? [sessionId, ...s.sessionOrder.filter((id) => id !== sessionId)]
        : [sessionId, ...s.sessionOrder];
      return {
        sessions: { ...s.sessions, [sessionId]: nextSession },
        sessionOrder: nextOrder,
      };
    });
    persistFromGet(get);
    return messageId;
  },
  appendAssistantToken: (sessionId, messageId, deltaText) => {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      const turns: PublicMessage[] = [...existing.turns];
      const last = turns[turns.length - 1];
      if (last && last.role === "assistant" && last.id === messageId) {
        turns[turns.length - 1] = { ...last, content: last.content + deltaText };
      } else {
        turns.push({
          id: messageId,
          role: "assistant",
          mode: "code",
          content: deltaText,
        });
      }
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, turns, updatedAt: Date.now() },
        },
      };
    });
    // Don't persist on every delta — too noisy. We persist on commit.
  },
  commitAssistant: (sessionId) => {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, updatedAt: Date.now() },
        },
      };
    });
    persistFromGet(get);
  },
  setTurnCount: (next) => {
    set({ turnCount: Math.max(0, Math.floor(next)) });
    persistFromGet(get);
  },
}));

/**
 * Derived gate selector. Returns `true` once the server-authoritative
 * `turnCount` has hit the limit — drives the `KeepChattingModal`
 * mount and the disabled state on the input bar.
 */
export function selectShouldShowGate(state: PublicChatStore): boolean {
  return state.turnCount >= state.limit;
}

/**
 * Pull the (optionally undefined) session for a given id without
 * forcing every consumer to re-derive the same lookup. Returns
 * `null` for unknown ids so callers can branch cleanly.
 */
export function selectSession(
  state: PublicChatStore,
  sessionId: string,
): PublicSession | null {
  return state.sessions[sessionId] ?? null;
}

function deriveTitle(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "New chat";
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}
