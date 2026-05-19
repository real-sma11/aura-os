import { useMemo } from "react";
import type { ProjectId } from "../../shared/types";
import { TaskStatusIcon } from "../../components/TaskStatusIcon";
import { Panel, Heading, Item } from "@cypher-asi/zui";
import { EmptyState } from "../../components/EmptyState";
import { getTaskDisplayStatus } from "../../shared/utils/task-display-status";
import { useLiveTaskIdsForProject } from "../../stores/live-task-ids-store";
import { useTaskFeedData } from "./useTaskFeedData";
import styles from "../aura.module.css";

interface TaskFeedProps {
  projectId: ProjectId;
}

export function TaskFeed({ projectId }: TaskFeedProps) {
  const { tasks, sorted, activeTaskId, loopActive } = useTaskFeedData(projectId);
  const displayed = sorted.slice(0, 50);
  // `useLiveTaskIdsForProject` is now a derived view over
  // `useLoopActivityStore` (single source of truth for "is this task
  // being worked on right now"). Union it with the feed's own
  // `activeTaskId` because that signal can be set from a
  // `task_started` event that this view subscribes to directly,
  // covering the brief window before the loop-activity store sees
  // the matching `LoopActivityChanged` broadcast.
  const projectLiveIds = useLiveTaskIdsForProject(projectId);
  const liveTaskIds = useMemo(() => {
    if (!activeTaskId) return projectLiveIds;
    if (projectLiveIds.has(activeTaskId)) return projectLiveIds;
    const merged = new Set(projectLiveIds);
    merged.add(activeTaskId);
    return merged;
  }, [activeTaskId, projectLiveIds]);

  return (
    <Panel variant="solid" border="solid" className={styles.panelColumn}>
      <div className={styles.feedHeader}>
        <Heading level={5}>Task Feed ({tasks.length})</Heading>
      </div>
      <div className={styles.feedList}>
        {displayed.map((task) => {
          const displayStatus = getTaskDisplayStatus(task, liveTaskIds, loopActive);
          return (
            <Item
              key={task.task_id}
              selected={loopActive && task.task_id === activeTaskId}
              style={task.parent_task_id ? { paddingLeft: "var(--space-6)" } : undefined}
            >
              <Item.Icon><TaskStatusIcon status={displayStatus} /></Item.Icon>
              <Item.Label>
                {task.parent_task_id ? `↳ ${task.title}` : task.title}
              </Item.Label>
            </Item>
          );
        })}
        {tasks.length === 0 && (
          <EmptyState>No tasks</EmptyState>
        )}
      </div>
    </Panel>
  );
}
