import type { Task, TaskStatus } from "../types";

/**
 * Resolve the per-row status the UI should render for `task`,
 * reconciling three sources of truth:
 *
 * 1. `task.status` — the storage-backed status loaded from
 *    `/projects/:id/tasks` (or merged from `task_saved` broadcasts).
 *    Lags behind reality during the windows where the harness has
 *    started a task but the storage transition hasn't been written
 *    yet, or after a crash that left a task pinned to `in_progress`.
 * 2. `liveTaskIds` — the per-project set of task ids the server
 *    reports as currently streaming (seeded from `/loop/status`'s
 *    `active_tasks` and patched by `task_started` /
 *    `task_completed` / `task_failed` WS events). Authoritative for
 *    "is this task being worked on right now".
 * 3. `loopActive` — whether the project's loop has any active
 *    agent instances at all.
 *
 * Two reconciliations are needed:
 *
 * - **Upgrade**: a task that the server reports as live should
 *   render as `in_progress` even if `task.status` is still `ready`
 *   (typical right after pressing Run, before the storage
 *   transition lands, or after a page refresh that hydrated
 *   `liveTaskIds` from `/loop/status` without refetching tasks).
 *   Without this, the per-task spinner stays as a hollow circle
 *   while the loop is actively working on it. Terminal statuses
 *   (`done` / `failed`) are never overridden — those represent the
 *   final state of a previous run.
 *
 * - **Downgrade**: a task whose storage status is `in_progress` but
 *   that the server does *not* report as live is almost certainly
 *   stale (a previous loop crashed mid-task and left the row
 *   pinned). Render it as `ready` so the UI doesn't show a misleading
 *   stale spinner. The downgrade only fires when there's other
 *   evidence the registry knows about (`loopActive` is false, or
 *   `liveTaskIds` has at least one entry that *isn't* this one)
 *   so a momentary live-set hydration lag during a real run can't
 *   accidentally demote the truly-running task.
 */
export function getTaskDisplayStatus(
  task: Task,
  liveTaskIds: Set<string>,
  loopActive: boolean,
): TaskStatus {
  // Upgrade: server says this task is live and storage hasn't
  // caught up yet. Don't override terminal statuses — they win.
  if (
    liveTaskIds.has(task.task_id)
    && task.status !== "done"
    && task.status !== "failed"
  ) {
    return "in_progress";
  }
  // Downgrade: storage says in_progress, server says no.
  if (
    task.status === "in_progress"
    && !liveTaskIds.has(task.task_id)
    && (!loopActive || liveTaskIds.size > 0)
  ) {
    return "ready";
  }
  return task.status;
}
