import { create } from "zustand";

/**
 * Lightweight version-counter store used to invalidate the agent
 * Chats sidekick (`ChatsTab`) when a new session is created elsewhere
 * (e.g. the chat input "+" button or the implicit rotation that
 * happens when `new_session: true` is sent on the next stream).
 *
 * `ChatsTab.useAgentSessions` includes `version` in its effect deps,
 * so any `bumpVersion()` call triggers a re-fetch of `api.listSessions`
 * for the active agent's project bindings without needing a manual
 * pub/sub or React Query.
 */
interface SessionsListStore {
  version: number;
  bumpVersion: () => void;
}

export const useSessionsListStore = create<SessionsListStore>((set) => ({
  version: 0,
  bumpVersion: () => set((s) => ({ version: s.version + 1 })),
}));
