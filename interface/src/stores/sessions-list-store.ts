import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import type { AnnotatedSession } from "../components/SessionsList";
import type { Session } from "../shared/types";
import { useProjectsListStore } from "./projects-list-store";

/** Synthetic session-id prefix for optimistic rows inserted on send. */
export const OPTIMISTIC_SESSION_ID_PREFIX = "optimistic:";

/**
 * `true` when the row is an optimistic placeholder this client inserted
 * after the user pressed `+` and sent a message but before the server
 * has streamed back `SessionReady` with the real id.
 */
export function isOptimisticSessionId(sessionId: string): boolean {
  return sessionId.startsWith(OPTIMISTIC_SESSION_ID_PREFIX);
}

/**
 * Builds an `AnnotatedSession` placeholder for the just-sent first
 * turn of a fresh chat. Empty `summary_of_previous_context` falls
 * through to `NEW_CHAT_PLACEHOLDER` ("New chat") in
 * `deriveSessionLabel`, matching how a real zero-summary session
 * would render. `started_at` defaults to now so the row sorts to the
 * top of `sortSessionsDesc`.
 */
export function buildOptimisticSession(args: {
  optimisticId: string;
  projectId: string;
  projectName: string;
  agentInstanceId: string;
  startedAt?: string;
}): AnnotatedSession {
  const startedAt = args.startedAt ?? new Date().toISOString();
  const session: Session = {
    session_id: args.optimisticId,
    agent_instance_id: args.agentInstanceId,
    project_id: args.projectId,
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "",
    status: "active",
    started_at: startedAt,
    ended_at: null,
  };
  return {
    ...session,
    _projectName: args.projectName,
    _projectId: args.projectId,
    _agentInstanceId: args.agentInstanceId,
  };
}

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
  /**
   * Insert a placeholder row for a brand-new session immediately, before
   * the server has streamed back `SessionReady`. Caller should pair with
   * `replaceSessionId` once the real id arrives. Idempotent on
   * `session_id`. The row carries the `OPTIMISTIC_SESSION_ID_PREFIX`
   * marker so concurrent `loadAgentSessions` / `loadProjectSessions`
   * calls preserve it across the merge.
   */
  addOptimisticSession: (surfaceKey: string, session: AnnotatedSession) => void;
  /**
   * Rewrite a row's `session_id` in place. Used to swap an optimistic
   * id for the real one once `SessionReady` arrives, keeping the row's
   * sort position and any summary that may have been resolved against
   * the optimistic id intact.
   */
  replaceSessionId: (
    surfaceKey: string,
    oldSessionId: string,
    newSessionId: string,
  ) => void;
  /**
   * Patch the persisted `summary_of_previous_context` for a session
   * across every surface that currently holds a row for it. Driven
   * by the `session_summary_updated` WebSocket event published from
   * the backend's on-send title generator (see
   * `apps/aura-os-server/src/handlers/agents/sessions.rs`
   * `generate_session_title`), so the sidekick label flips from
   * "New chat" to the ChatGPT-style title before the assistant turn
   * finishes streaming. Surfaces that don't currently hold the row
   * keep their existing array reference to avoid spurious renders.
   */
  setSessionSummary: (sessionId: string, summary: string) => void;
  /** Surface the user-facing reason a delete failed for `surfaceKey`. */
  setDeleteError: (surfaceKey: string, message: string | null) => void;
}

function sortSessionsDesc(sessions: AnnotatedSession[]): AnnotatedSession[] {
  return [...sessions].sort(
    (a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
}

/**
 * Carry forward any optimistic placeholder rows from the previous
 * surface state into a fresh load result. The server's `list_sessions`
 * filters out zero-event sessions, so a refetch triggered by
 * `SessionReady` may briefly miss the just-created session — without
 * this guard the optimistic row would flicker out and back in. Once
 * `replaceSessionId` swaps the marker for the real id, the next load
 * sees a non-optimistic id and the placeholder isn't carried again.
 */
function preserveOptimisticRows(
  prev: AnnotatedSession[] | undefined,
  next: AnnotatedSession[],
): AnnotatedSession[] {
  if (!prev || prev.length === 0) return next;
  const optimistic = prev.filter((s) => isOptimisticSessionId(s.session_id));
  if (optimistic.length === 0) return next;
  const seen = new Set(next.map((s) => s.session_id));
  const carried = optimistic.filter((s) => !seen.has(s.session_id));
  if (carried.length === 0) return next;
  return sortSessionsDesc([...next, ...carried]);
}

// Per-surface request-id counters keep racing responses from clobbering
// each other when, e.g., a stream-driven `bumpVersion` lands while a
// previous load is still in flight.
const surfaceRequestIds: Record<string, number> = {};

export const useSessionsListStore = create<SessionsListStore>((set, get) => ({
  sessionsBySurface: {},
  loadingBySurface: {},
  deleteErrorBySurface: {},
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
        sessionsBySurface: {
          ...state.sessionsBySurface,
          [surfaceKey]: preserveOptimisticRows(
            state.sessionsBySurface[surfaceKey],
            merged,
          ),
        },
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
        sessionsBySurface: {
          ...state.sessionsBySurface,
          [surfaceKey]: preserveOptimisticRows(
            state.sessionsBySurface[surfaceKey],
            annotated,
          ),
        },
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

  addOptimisticSession: (surfaceKey, session) => {
    const current = get().sessionsBySurface[surfaceKey] ?? EMPTY_SESSIONS;
    if (current.some((s) => s.session_id === session.session_id)) return;
    const next = sortSessionsDesc([...current, session]);
    set((state) => ({
      sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
    }));
  },

  replaceSessionId: (surfaceKey, oldSessionId, newSessionId) => {
    if (oldSessionId === newSessionId) return;
    const current = get().sessionsBySurface[surfaceKey];
    if (!current) return;
    const idx = current.findIndex((s) => s.session_id === oldSessionId);
    if (idx === -1) return;
    // If a row with `newSessionId` already exists (e.g. a parallel
    // load brought it in before SessionReady landed), drop the
    // optimistic placeholder rather than producing two rows for the
    // same session.
    if (current.some((s) => s.session_id === newSessionId)) {
      const next = current.filter((s) => s.session_id !== oldSessionId);
      set((state) => ({
        sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
      }));
      return;
    }
    const next = current.slice();
    next[idx] = { ...current[idx], session_id: newSessionId };
    set((state) => ({
      sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
    }));
  },

  setSessionSummary: (sessionId, summary) => {
    const sessionsBySurface = get().sessionsBySurface;
    let mutated = false;
    const nextBySurface: Record<string, AnnotatedSession[]> = {};
    for (const [key, list] of Object.entries(sessionsBySurface)) {
      const idx = list.findIndex((s) => s.session_id === sessionId);
      if (idx === -1) {
        nextBySurface[key] = list;
        continue;
      }
      if (list[idx].summary_of_previous_context === summary) {
        nextBySurface[key] = list;
        continue;
      }
      const nextList = list.slice();
      nextList[idx] = { ...list[idx], summary_of_previous_context: summary };
      nextBySurface[key] = nextList;
      mutated = true;
    }
    if (!mutated) return;
    set(() => ({ sessionsBySurface: nextBySurface }));
  },

  setDeleteError: (surfaceKey, message) => {
    set((state) => ({
      deleteErrorBySurface: {
        ...state.deleteErrorBySurface,
        [surfaceKey]: message,
      },
    }));
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
 */
export function useSessionsForSurface(
  surfaceKey: string | undefined,
): AnnotatedSession[] {
  return useSessionsListStore(
    useShallow((state) => {
      if (!surfaceKey) return EMPTY_SESSIONS;
      return state.sessionsBySurface[surfaceKey] ?? EMPTY_SESSIONS;
    }),
  );
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
  addOptimisticSession: (surfaceKey: string, session: AnnotatedSession) => void;
  replaceSessionId: (
    surfaceKey: string,
    oldSessionId: string,
    newSessionId: string,
  ) => void;
  setSessionSummary: (sessionId: string, summary: string) => void;
  setDeleteError: (surfaceKey: string, message: string | null) => void;
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
      addOptimisticSession: s.addOptimisticSession,
      replaceSessionId: s.replaceSessionId,
      setSessionSummary: s.setSessionSummary,
      setDeleteError: s.setDeleteError,
    })),
  );
}
