import { useLoopActivityStore } from "./loop-activity-store";
import { useTaskOutputPanelStore } from "./task-output-panel-store";
import type { LoopStatusResponse } from "../shared/api/loop";
import type { ProjectId } from "../shared/types";

/**
 * Seed Run pane rows from loop-activity snapshots when `current_task_id`
 * is set but `task_started` was missed over WS (lag, reconnect, or race).
 */
export function syncRunPaneFromLoopActivity(projectId?: string): void {
  const loops = useLoopActivityStore.getState().loops;
  const panel = useTaskOutputPanelStore.getState();
  for (const row of Object.values(loops)) {
    if (projectId && row.loopId.project_id !== projectId) continue;
    const taskId = row.activity.current_task_id;
    if (typeof taskId !== "string" || !taskId) continue;
    const pid = row.loopId.project_id;
    if (!pid) continue;
    panel.hydrateActiveTask(taskId, pid, row.loopId.agent_instance_id ?? undefined);
  }
}

/**
 * Reconcile Run pane rows from `/loop/status`, `/loop/start`, or
 * `/loop/resume` snapshots. Shared by AutomationBar start/stop paths
 * and periodic status polling.
 */
export function hydrateActiveTasksFromLoopStatus(
  res: LoopStatusResponse,
  projectId: ProjectId,
): void {
  const active = res.active_tasks ?? [];
  const loopRunning = (res.active_agent_instances ?? []).length > 0;
  const panel = useTaskOutputPanelStore.getState();
  // Reconcile BEFORE promoting the new rows: any locally-"active" row
  // for this project whose task the server no longer reports as active
  // is a leftover from a stopped / refreshed prior run, and would
  // otherwise render its own cooking indicator alongside the new run's
  // row. Demote to "interrupted" as a transient holding state -- the
  // subsequent `reconcilePanelStatuses` pass (driven by
  // `/projects/:pid/tasks`) upgrades it to `completed` / `failed` once
  // the authoritative per-task status loads.
  //
  // Automation ramp-up exception: `/loop/start` assembles its response
  // before the forwarder processes the first harness event, so
  // `active_tasks` is often `[]` even while the loop is running.
  // WS `task_started` / implicit-bind rows can land in that window; do
  // NOT demote them when the loop is live but the snapshot is still
  // task-less (single-task runs avoid this by emitting `task_started`
  // synchronously during register).
  const keepIds = active.map((t) => t.task_id).filter(Boolean);
  const skipDemoteWhileTasklessRampUp = loopRunning && keepIds.length === 0;
  if (!skipDemoteWhileTasklessRampUp) {
    panel.demoteStaleActive(projectId, keepIds);
  }
  for (const entry of active) {
    if (!entry.task_id) continue;
    panel.hydrateActiveTask(entry.task_id, projectId, entry.agent_instance_id);
  }
}
