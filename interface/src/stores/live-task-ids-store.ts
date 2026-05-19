import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { LoopStatusResponse } from "../shared/api/loop";
import {
  selectActiveTaskIdsForProject,
  useLoopActivityStore,
} from "./loop-activity-store";

/**
 * Per-project set of task ids the server reports as currently streaming.
 *
 * Lives in a shared zustand store (rather than local React state inside
 * `useTaskListData` / `useMobileTasks`) so the Run-start HTTP response can
 * seed the "live" indicator immediately — before the `task_started` WS
 * event arrives — for both the desktop sidekick Tasks list and the mobile
 * task views. Without this shared state, pressing Run on a fresh or
 * interrupted task leaves the sidekick looking idle during the ramp-up
 * window between `POST /loop/start` and the first `task_started` event.
 */
interface LiveTaskIdsState {
  idsByProject: Record<string, Set<string>>;

  addLive: (projectId: string, taskId: string) => void;
  removeLive: (projectId: string, taskId: string) => void;
  clearProject: (projectId: string) => void;
  /**
   * Merge any `active_tasks` reported by `/loop/status` (or the response
   * from `/loop/start` / `/loop/resume`) into the per-project live set.
   * No-op when the response carries no `active_tasks`, so callers can
   * pass any `LoopStatusResponse` without pre-checking.
   */
  hydrateFromLoopStatus: (res: LoopStatusResponse, projectId: string) => void;
}

export const useLiveTaskIdsStore = create<LiveTaskIdsState>()((set) => ({
  idsByProject: {},

  addLive: (projectId, taskId) =>
    set((s) => {
      const current = s.idsByProject[projectId];
      if (current?.has(taskId)) return s;
      const next = new Set(current ?? []);
      next.add(taskId);
      return { idsByProject: { ...s.idsByProject, [projectId]: next } };
    }),

  removeLive: (projectId, taskId) =>
    set((s) => {
      const current = s.idsByProject[projectId];
      if (!current || !current.has(taskId)) return s;
      const next = new Set(current);
      next.delete(taskId);
      return { idsByProject: { ...s.idsByProject, [projectId]: next } };
    }),

  clearProject: (projectId) =>
    set((s) => {
      const current = s.idsByProject[projectId];
      if (!current || current.size === 0) return s;
      return { idsByProject: { ...s.idsByProject, [projectId]: new Set() } };
    }),

  hydrateFromLoopStatus: (res, projectId) =>
    set((s) => {
      const incoming = res.active_tasks;
      if (!incoming || incoming.length === 0) return s;
      const current = s.idsByProject[projectId];
      const next = new Set(current ?? []);
      let changed = false;
      for (const entry of incoming) {
        if (entry.task_id && !next.has(entry.task_id)) {
          next.add(entry.task_id);
          changed = true;
        }
      }
      return changed
        ? { idsByProject: { ...s.idsByProject, [projectId]: next } }
        : s;
    }),
}));

const EMPTY_SET: Set<string> = new Set();

/**
 * React hook: subscribe to the live task ids for a single project.
 * Returns a stable empty set when `projectId` is missing or the project
 * has no live tasks, so callers can safely use `Set` methods without
 * null checks. The returned set must be treated as immutable — mutate
 * the store via the exposed actions instead.
 */
export function useLiveTaskIdsForProject(
  projectId: string | undefined,
): Set<string> {
  return useLiveTaskIdsStore((s) => {
    if (!projectId) return EMPTY_SET;
    return s.idsByProject[projectId] ?? EMPTY_SET;
  });
}

/**
 * React hook: union of `useLiveTaskIdsForProject` + every task id
 * that an actively-running loop in
 * [`useLoopActivityStore`](./loop-activity-store.ts) is currently
 * working on for this project.
 *
 * Why both: the two stores answer the same question ("is this task
 * being worked on right now") but are fed by independent code paths
 * (WS `task_started` + `/loop/status.active_tasks` for the live-ids
 * store, WS `LoopActivityChanged` for the loop-activity store).
 * Either one can briefly fall behind during the ramp-up window of a
 * fresh run — but they almost never both fail simultaneously, so
 * unioning them gives the per-row spinner a much more reliable
 * "task is live" signal than either source alone. See the
 * `selectActiveTaskIdsForProject` doc-comment for the failure-mode
 * walk-through.
 *
 * Returns a fresh `Set` each call when either source contributes
 * ids, so consumers should pass it through `useMemo` if they
 * iterate it across renders. Returns `EMPTY_SET` (a stable empty
 * Set instance) when both sources are empty so the most common
 * "idle" case still gets reference-equality wins.
 */
export function useEffectiveLiveTaskIdsForProject(
  projectId: string | undefined,
): Set<string> {
  const fromLiveStore = useLiveTaskIdsForProject(projectId);
  const fromLoopActivity = useLoopActivityStore(
    useShallow((s) => Array.from(selectActiveTaskIdsForProject(s, projectId))),
  );
  if (fromLoopActivity.length === 0) return fromLiveStore;
  if (fromLiveStore.size === 0) return new Set(fromLoopActivity);
  const merged = new Set(fromLiveStore);
  for (const id of fromLoopActivity) merged.add(id);
  return merged;
}

/**
 * Dev-only: expose the live-task-ids + loop-activity stores under
 * `window.__AURA_DEBUG_STORES__` so the user can poke at them from
 * DevTools when chasing per-row spinner regressions. Off in production
 * builds by gating on `import.meta.env.DEV`.
 *
 * Sample devtools session:
 *
 * ```js
 * Object.keys(__AURA_DEBUG_STORES__.liveTaskIds.getState().idsByProject)
 * Object.values(__AURA_DEBUG_STORES__.loopActivity.getState().loops)
 *   .map(r => ({ status: r.activity.status, task: r.activity.current_task_id }))
 * ```
 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as {
    __AURA_DEBUG_STORES__?: Record<string, unknown>;
  }).__AURA_DEBUG_STORES__ = {
    ...(window as unknown as {
      __AURA_DEBUG_STORES__?: Record<string, unknown>;
    }).__AURA_DEBUG_STORES__,
    liveTaskIds: useLiveTaskIdsStore,
    loopActivity: useLoopActivityStore,
  };
}
