import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import type { AnnotatedSession } from "../components/SessionsList";
import { useProjectsListStore } from "./projects-list-store";

/**
 * Centralized session-list state shared by every surface that lists
 * sessions: the agents `ChatsTab` sidekick, the projects `SessionList`
 * sidekick, and both default-session redirect hooks. Keeping one store
 * means we only fetch each list once per surface, and the redirects
 * read the same array the sidekick is rendering instead of duplicating
 * the API call.
 *
 * Surface keys are namespaced so the agents-app and projects-app
 * surfaces never collide:
 * - `agent:{agentId}`     — every session across the agent's bindings
 * - `project:{projectId}` — every session across an entire project
 *
 * `version` is preserved as a write-side bump that consumers fold into
 * their effect dependencies; calling `bumpVersion()` after a stream
 * emits `SessionReady` (or after the chat-input "+" / RotateCcw soft
 * reset) re-runs the load so newly-persisted sessions surface without
 * a manual refresh.
 */

const EMPTY_SESSIONS: AnnotatedSession[] = [];

export function agentSessionsSurfaceKey(agentId: string): string {
  return `agent:${agentId}`;
}

export function projectSessionsSurfaceKey(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Synthetic session id used by the optimistic "New chat" placeholder
 * row that the chat-input "+" button surfaces in the sidekick. The
 * placeholder is purely client-side: it never hits the API, never
 * appears in `loadAgentSessions` results, and is replaced by the real
 * session row once the first send fires `SessionReady`. Exported so
 * tests and downstream consumers can match against the same constant.
 */
export const PENDING_NEW_CHAT_ID = "pending-new-chat";

/**
 * `AnnotatedSession` carrying a `_pending: true` flag so the rest of
 * the app can distinguish the optimistic placeholder from a real,
 * server-persisted session row. The placeholder is synthesized in
 * `handleNewChat` (chat-input "+" path) and dropped on `SessionReady`
 * once the server hands back the real session id. Consumers that care
 * about the placeholder vs real-session distinction key off this flag
 * directly (see `SessionsList` row rendering and `ChatsTab` click /
 * delete short-circuits).
 */
export interface PendingNewChat extends AnnotatedSession {
  _pending: true;
}

interface SessionsListStore {
  /** Newest-first AnnotatedSession arrays keyed by surface. */
  sessionsBySurface: Record<string, AnnotatedSession[]>;
  /** Active in-flight load per surface (for empty-state UX). */
  loadingBySurface: Record<string, boolean>;
  /**
   * Most-recent failed-delete message per surface, surfaced inline by
   * `SessionsList` as a small dismissible banner. `null` (or missing
   * key) means "no error to show". Lives in the store rather than
   * local component state so the agents-app `ChatsTab` and the
   * projects-app `SessionList` reuse the same plumbing without each
   * building their own toast wrapper.
   */
  deleteErrorBySurface: Record<string, string | null>;
  /**
   * Optimistic "New chat" placeholder per surface. Set when the user
   * clicks "+" in the chat input bar so the sidekick gets immediate
   * "yes, you started a fresh chat" feedback (mirrors ChatGPT's
   * behaviour where the side panel jumps to a "New chat" row before
   * the first message sends). `useSessionsForSurface` prepends the
   * placeholder to its returned list. Cleared by `clearPendingNewChat`
   * on `SessionReady` (the real row arrives from the next
   * `loadAgentSessions` driven by `bumpVersion`).
   */
  pendingNewChatBySurface: Record<string, PendingNewChat>;
  /** Bumped on every relevant write so polling consumers can re-run. */
  version: number;
  bumpVersion: () => void;
  /** Fan-out fetch across every project the agent is bound to. */
  loadAgentSessions: (agentId: string) => Promise<void>;
  /** Single project-wide fetch annotating rows with project metadata. */
  loadProjectSessions: (projectId: string, projectName: string) => Promise<void>;
  /** Optimistic delete; pair with `restoreSession` to undo on error. */
  removeSession: (surfaceKey: string, sessionId: string) => void;
  restoreSession: (surfaceKey: string, session: AnnotatedSession) => void;
  /** Surface the user-facing reason a delete failed for `surfaceKey`. */
  setDeleteError: (surfaceKey: string, message: string | null) => void;
  /** Set / replace the optimistic "New chat" placeholder for a surface. */
  setPendingNewChat: (surfaceKey: string, pending: PendingNewChat) => void;
  /** Replace a pending placeholder with the server-assigned session id. */
  promotePendingNewChat: (surfaceKey: string, sessionId: string) => void;
  /** Drop the optimistic "New chat" placeholder for a surface. */
  clearPendingNewChat: (surfaceKey: string) => void;
}

function sortSessionsDesc(sessions: AnnotatedSession[]): AnnotatedSession[] {
  return [...sessions].sort(
    (a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
}

function pendingMatchesSession(
  pending: PendingNewChat | undefined,
  session: AnnotatedSession,
): boolean {
  if (!pending) return false;
  return (
    pending._projectId === session._projectId &&
    pending._agentInstanceId === session._agentInstanceId
  );
}

// Per-surface request-id counters keep racing responses from clobbering
// each other when, e.g., a stream-driven `bumpVersion` lands while a
// previous load is still in flight.
const surfaceRequestIds: Record<string, number> = {};

export const useSessionsListStore = create<SessionsListStore>((set, get) => ({
  sessionsBySurface: {},
  loadingBySurface: {},
  deleteErrorBySurface: {},
  pendingNewChatBySurface: {},
  version: 0,

  bumpVersion: () => set((s) => ({ version: s.version + 1 })),

  loadAgentSessions: async (agentId) => {
    const surfaceKey = agentSessionsSurfaceKey(agentId);
    const requestId = (surfaceRequestIds[surfaceKey] ?? 0) + 1;
    surfaceRequestIds[surfaceKey] = requestId;

    set((state) => ({
      loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: true },
    }));

    // Bindings are derived from a snapshot of `useProjectsListStore`
    // rather than via a live selector — that's deliberate. A subscribed
    // selector that materializes `{ projectId, agentInstanceId }` pairs
    // hands `useShallow` fresh object references on every call, which
    // re-triggers the consumer in an infinite loop and is exactly the
    // bug this store replaces.
    const projectsState = useProjectsListStore.getState();
    const bindings: {
      projectId: string;
      agentInstanceId: string;
      projectName: string;
    }[] = [];
    for (const project of projectsState.projects) {
      const instances = projectsState.agentsByProject[project.project_id];
      if (!instances) continue;
      for (const instance of instances) {
        if (instance.agent_id === agentId) {
          bindings.push({
            projectId: project.project_id,
            agentInstanceId: instance.agent_instance_id,
            projectName: project.name,
          });
        }
      }
    }

    try {
      const results = await Promise.all(
        bindings.map((b) =>
          api
            .listSessions(b.projectId, b.agentInstanceId)
            .then((list) =>
              list.map<AnnotatedSession>((s) => ({
                ...s,
                _projectName: b.projectName,
                _projectId: b.projectId,
                _agentInstanceId: b.agentInstanceId,
              })),
            )
            .catch(() => [] as AnnotatedSession[]),
        ),
      );
      if (surfaceRequestIds[surfaceKey] !== requestId) return;
      const merged = sortSessionsDesc(results.flat());
      set((state) => ({
        sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: merged },
        pendingNewChatBySurface: merged.some((session) =>
          pendingMatchesSession(
            state.pendingNewChatBySurface[surfaceKey],
            session,
          ),
        )
          ? Object.fromEntries(
              Object.entries(state.pendingNewChatBySurface).filter(
                ([key]) => key !== surfaceKey,
              ),
            )
          : state.pendingNewChatBySurface,
      }));
    } catch (err) {
      console.error("Failed to load agent sessions", err);
    } finally {
      if (surfaceRequestIds[surfaceKey] === requestId) {
        set((state) => ({
          loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: false },
        }));
      }
    }
  },

  loadProjectSessions: async (projectId, projectName) => {
    const surfaceKey = projectSessionsSurfaceKey(projectId);
    const requestId = (surfaceRequestIds[surfaceKey] ?? 0) + 1;
    surfaceRequestIds[surfaceKey] = requestId;

    set((state) => ({
      loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: true },
    }));

    try {
      const list = await api.listProjectSessions(projectId);
      if (surfaceRequestIds[surfaceKey] !== requestId) return;
      const annotated = sortSessionsDesc(
        list.map<AnnotatedSession>((s) => ({
          ...s,
          _projectName: projectName,
          _projectId: s.project_id,
          _agentInstanceId: s.agent_instance_id,
        })),
      );
      set((state) => ({
        sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: annotated },
      }));
    } catch (err) {
      console.error("Failed to load project sessions", err);
    } finally {
      if (surfaceRequestIds[surfaceKey] === requestId) {
        set((state) => ({
          loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: false },
        }));
      }
    }
  },

  removeSession: (surfaceKey, sessionId) => {
    const current = get().sessionsBySurface[surfaceKey];
    if (!current) return;
    const next = current.filter((s) => s.session_id !== sessionId);
    if (next.length === current.length) return;
    set((state) => ({
      sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
    }));
  },

  restoreSession: (surfaceKey, session) => {
    const current = get().sessionsBySurface[surfaceKey] ?? EMPTY_SESSIONS;
    if (current.some((s) => s.session_id === session.session_id)) return;
    const next = sortSessionsDesc([...current, session]);
    set((state) => ({
      sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
    }));
  },

  setDeleteError: (surfaceKey, message) => {
    set((state) => ({
      deleteErrorBySurface: {
        ...state.deleteErrorBySurface,
        [surfaceKey]: message,
      },
    }));
  },

  setPendingNewChat: (surfaceKey, pending) => {
    set((state) => ({
      pendingNewChatBySurface: {
        ...state.pendingNewChatBySurface,
        [surfaceKey]: pending,
      },
    }));
  },

  promotePendingNewChat: (surfaceKey, sessionId) => {
    const pending = get().pendingNewChatBySurface[surfaceKey];
    if (!pending) return;
    const realSession = {
      ...pending,
      session_id: sessionId,
    } as AnnotatedSession & { _pending?: boolean };
    delete realSession._pending;
    set((state) => {
      const current = state.sessionsBySurface[surfaceKey] ?? EMPTY_SESSIONS;
      const withoutDuplicate = current.filter((s) => s.session_id !== sessionId);
      const pendingNewChatBySurface = { ...state.pendingNewChatBySurface };
      delete pendingNewChatBySurface[surfaceKey];
      return {
        sessionsBySurface: {
          ...state.sessionsBySurface,
          [surfaceKey]: sortSessionsDesc([realSession, ...withoutDuplicate]),
        },
        pendingNewChatBySurface,
      };
    });
  },

  clearPendingNewChat: (surfaceKey) => {
    const current = get().pendingNewChatBySurface;
    if (!(surfaceKey in current)) return;
    const next = { ...current };
    delete next[surfaceKey];
    set({ pendingNewChatBySurface: next });
  },
}));

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

/**
 * Returns the same array reference across re-renders when the
 * underlying store entry hasn't changed. The empty fallback is a
 * module-level singleton so consumers that call this for not-yet-loaded
 * surfaces don't churn `useShallow` consumers.
 *
 * When an optimistic "New chat" placeholder is set for the surface
 * (via `setPendingNewChat` from the chat-input "+" path), it is
 * prepended to the returned list so the sidekick highlights a "New
 * chat" row immediately. The placeholder participates in render-time
 * rendering only — it carries `_pending: true` so consumers (clicks,
 * deletes, summarization) can short-circuit on it. It is intentionally
 * kept out of the underlying `sessionsBySurface[surfaceKey]` array so
 * `loadAgentSessions` / `loadProjectSessions` writes don't have to
 * thread the placeholder through their request-id race protections —
 * the placeholder lives on a sibling axis and is only dropped via
 * explicit `clearPendingNewChat` (typically on `SessionReady`).
 */
export function useSessionsForSurface(
  surfaceKey: string | undefined,
): AnnotatedSession[] {
  return useSessionsListStore(
    useShallow((state) => {
      if (!surfaceKey) return EMPTY_SESSIONS;
      const list = state.sessionsBySurface[surfaceKey] ?? EMPTY_SESSIONS;
      const pending = state.pendingNewChatBySurface[surfaceKey];
      if (!pending) return list;
      return [pending, ...list];
    }),
  );
}

/**
 * Subscribes to the optimistic "New chat" placeholder for `surfaceKey`,
 * or `null` when none is set. `ChatsTab` uses this to compute an
 * effective `selectedSessionId` that highlights the placeholder row
 * while `?session=` is absent from the URL (post chat-input "+" but
 * pre-`SessionReady`).
 */
export function usePendingNewChat(
  surfaceKey: string | undefined,
): PendingNewChat | null {
  return useSessionsListStore((state) => {
    if (!surfaceKey) return null;
    return state.pendingNewChatBySurface[surfaceKey] ?? null;
  });
}

export function useSessionsLoading(surfaceKey: string | undefined): boolean {
  return useSessionsListStore((state) => {
    if (!surfaceKey) return false;
    return state.loadingBySurface[surfaceKey] ?? false;
  });
}

/**
 * Most-recent failed-delete message for the surface, or `null` when
 * the last delete succeeded (or none has run yet). `SessionsList`
 * subscribes to this to render its inline error banner.
 */
export function useSessionsDeleteError(
  surfaceKey: string | undefined,
): string | null {
  return useSessionsListStore((state) => {
    if (!surfaceKey) return null;
    return state.deleteErrorBySurface[surfaceKey] ?? null;
  });
}

/**
 * Most-recent session by `started_at` for the surface. Sessions are
 * stored already-sorted desc, so this is just `[0]` — a stable
 * reference that doesn't allocate.
 */
export function useMostRecentSession(
  surfaceKey: string | undefined,
): AnnotatedSession | null {
  return useSessionsListStore((state) => {
    if (!surfaceKey) return null;
    const list = state.sessionsBySurface[surfaceKey];
    return list && list.length > 0 ? list[0] : null;
  });
}

/**
 * Stable string fingerprint of an agent's `(projectId, instanceId)`
 * bindings. Returns "" when the agent has none yet. Use this as a hook
 * dependency to drive a `loadAgentSessions` call when bindings appear
 * (e.g. once the background `agentsByProject` prefetch lands) without
 * the infinite-render-loop trap that an object-array selector hits.
 */
export function useAgentBindingsKey(agentId: string | undefined): string {
  return useProjectsListStore((s) => {
    if (!agentId) return "";
    const parts: string[] = [];
    for (const project of s.projects) {
      const instances = s.agentsByProject[project.project_id];
      if (!instances) continue;
      for (const instance of instances) {
        if (instance.agent_id === agentId) {
          parts.push(`${project.project_id}:${instance.agent_instance_id}`);
        }
      }
    }
    parts.sort();
    return parts.join(",");
  });
}

interface SessionsListActions {
  loadAgentSessions: (agentId: string) => Promise<void>;
  loadProjectSessions: (projectId: string, projectName: string) => Promise<void>;
  removeSession: (surfaceKey: string, sessionId: string) => void;
  restoreSession: (surfaceKey: string, session: AnnotatedSession) => void;
  setDeleteError: (surfaceKey: string, message: string | null) => void;
  setPendingNewChat: (surfaceKey: string, pending: PendingNewChat) => void;
  promotePendingNewChat: (surfaceKey: string, sessionId: string) => void;
  clearPendingNewChat: (surfaceKey: string) => void;
}

/**
 * Convenience accessor for the imperative actions; using
 * `useSessionsListStore.getState()` inline works too but this keeps the
 * action-vs-state split visible in the call sites.
 */
export function useSessionsListActions(): SessionsListActions {
  return useSessionsListStore(
    useShallow((s) => ({
      loadAgentSessions: s.loadAgentSessions,
      loadProjectSessions: s.loadProjectSessions,
      removeSession: s.removeSession,
      restoreSession: s.restoreSession,
      setDeleteError: s.setDeleteError,
      setPendingNewChat: s.setPendingNewChat,
      promotePendingNewChat: s.promotePendingNewChat,
      clearPendingNewChat: s.clearPendingNewChat,
    })),
  );
}
