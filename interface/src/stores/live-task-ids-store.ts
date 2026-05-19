import { useShallow } from "zustand/react/shallow";

import {
  selectActiveTaskIdsForProject,
  useLoopActivityStore,
} from "./loop-activity-store";

/**
 * Per-project set of task ids whose loop is currently working on
 * them.
 *
 * # Single source of truth
 *
 * This module is intentionally thin: it's a derived view over
 * [`useLoopActivityStore`](./loop-activity-store.ts), not its own
 * store. The previous design carried a parallel `idsByProject` Map
 * fed by `task_started` / `task_completed` / `task_failed` WS
 * subscribers and `/loop/status.active_tasks` polls — independent of
 * the `LoopActivityChanged` pipeline that already wrote
 * `current_task_id` onto `loop-activity-store`. Two stores answering
 * the same "is this task being worked on right now" question with
 * different feed paths invited the exact bug class we just fixed:
 * the per-row spinner went hollow because one store was up-to-date
 * and the other lagged.
 *
 * Every signal that used to populate the parallel store is already
 * captured by `loop-activity-store`:
 *
 * | Old signal                              | New equivalent                                                 |
 * | --------------------------------------- | -------------------------------------------------------------- |
 * | `task_started` WS → `addLive`           | `LoopActivityChanged` (set_current_task → throttle bypass)     |
 * | `task_completed` / `task_failed`        | `LoopActivityChanged` with `current_task_id: None`             |
 * | `LoopStopped` / `LoopFinished`          | `LoopEnded` removes the row entirely                           |
 * | `LoopPaused`                            | `LoopActivityChanged` flips `status` to `paused` (non-active)  |
 * | `/loop/start` ramp-up `active_tasks`    | `LoopOpened` then `LoopActivityChanged` for the first task     |
 * | `/loop/status.active_tasks` poll        | `/api/loops` snapshot via `useLoopActivityStore.hydrate()`     |
 *
 * Consumers see a single Set per project. Callers in
 * `useTaskListData` / `useMobileTasks` / `TaskFeed` no longer need
 * to maintain anything — the spinner update is automatic.
 *
 * # Active-only filter
 *
 * `selectActiveTaskIdsForProject` already filters out loops whose
 * status isn't `isLoopActivityActive` (so paused / stalled-but-still-
 * tracked / completed-but-not-yet-removed rows don't pollute the
 * set). That mirrors the previous semantics: `clearProject` was
 * called on `LoopStopped` / `LoopPaused` / `LoopFinished` to keep
 * paused-but-tracked tasks out of the spinner; the `isActive`
 * filter does the same job structurally.
 */
export function useLiveTaskIdsForProject(
  projectId: string | undefined,
): Set<string> {
  // `useShallow` over the materialized array (rather than the Set
  // itself) lets zustand do a stable reference-equality check
  // across re-renders when the underlying ids haven't changed.
  // Returning a fresh `Set` from the selector each render would
  // re-trigger every consumer otherwise, which matters because
  // every Explorer row in `TaskList` subscribes via this hook.
  const ids = useLoopActivityStore(
    useShallow((s) => Array.from(selectActiveTaskIdsForProject(s, projectId))),
  );
  // The constructor here is cheap (small N — bounded by concurrent
  // active loops in the project, typically 0–2) and `ids` itself is
  // stable thanks to `useShallow`, so the resulting Set is
  // referentially stable too.
  return new Set(ids);
}

/**
 * Dev-only: expose the loop-activity store under
 * `window.__AURA_DEBUG_STORES__` so the user can poke at it from
 * DevTools when chasing per-row spinner regressions. Off in
 * production builds by gating on `import.meta.env.DEV`.
 *
 * Sample devtools session:
 *
 * ```js
 * Object.values(__AURA_DEBUG_STORES__.loopActivity.getState().loops)
 *   .map(r => ({
 *     status: r.activity.status,
 *     task: r.activity.current_task_id,
 *     project: r.loopId.project_id,
 *   }))
 * ```
 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as {
    __AURA_DEBUG_STORES__?: Record<string, unknown>;
  }).__AURA_DEBUG_STORES__ = {
    ...(window as unknown as {
      __AURA_DEBUG_STORES__?: Record<string, unknown>;
    }).__AURA_DEBUG_STORES__,
    loopActivity: useLoopActivityStore,
  };
}
