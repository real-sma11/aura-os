import { useLoopActivityStore } from "./loop-activity-store";
import { useTaskOutputPanelStore } from "./task-output-panel-store";

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
