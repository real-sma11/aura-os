import { useEffect, useState, useMemo } from "react";
import { api } from "../../api/client";
import type { Task } from "../../shared/types";
import { EventType } from "../../shared/types/aura-events";
import { useProjectActions } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store/index";
import { useLiveTaskIdsForProject } from "../../stores/live-task-ids-store";
import { useLoopActive } from "../../hooks/use-loop-active";

function sortByOrder<T extends { order_index: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.order_index - right.order_index);
}

interface MobileTasksData {
  tasks: Task[];
  tasksBySpec: Map<string, Task[]>;
  liveTaskIds: Set<string>;
  loopActive: boolean;
}

export function useMobileTasks(projectId: string): MobileTasksData {
  const ctx = useProjectActions();
  const subscribe = useEventStore((s) => s.subscribe);
  const loopActive = useLoopActive(projectId);
  const [tasks, setTasks] = useState<Task[]>(() => sortByOrder(ctx?.initialTasks ?? []));
  // Single source of truth for "is this task live": derived from
  // `useLoopActivityStore` via `useLiveTaskIdsForProject`. The
  // previous design kept a parallel cache here that this hook
  // mirrored from `task_started` etc., which let the cache lag the
  // `LoopActivityChanged` pipeline and produce a hollow per-row
  // spinner during an active run. See the doc-comment in
  // `live-task-ids-store.ts` for the full migration table.
  const liveTaskIds = useLiveTaskIdsForProject(projectId);

  const tasksBySpec = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      const bucket = grouped.get(task.spec_id) ?? [];
      bucket.push(task);
      grouped.set(task.spec_id, bucket);
    }
    return grouped;
  }, [tasks]);

  useEffect(() => {
    setTasks(sortByOrder(ctx?.initialTasks ?? []));
  }, [ctx?.initialTasks]);

  useEffect(() => {
    let cancelled = false;
    void api.listTasks(projectId).then((nextTasks) => {
      if (!cancelled) setTasks(sortByOrder(nextTasks));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    const setStatus = (taskId: string, status: Task["status"]) =>
      setTasks((prev) => prev.map((t) => (t.task_id === taskId ? { ...t, status } : t)));

    const unsubs = [
      subscribe(EventType.TaskSaved, (e) => {
        const task = e.content.task;
        if (e.project_id !== projectId || !task) return;
        setTasks((prev) => sortByOrder(
          prev.some((candidate) => candidate.task_id === task.task_id)
            ? prev.map((candidate) => candidate.task_id === task.task_id ? task : candidate)
            : [...prev, task],
        ));
      }),
      subscribe(EventType.TaskStarted, (e) => {
        if (e.content.task_id) setStatus(e.content.task_id, "in_progress");
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        if (e.content.task_id) setStatus(e.content.task_id, "done");
      }),
      subscribe(EventType.TaskFailed, (e) => {
        if (e.content.task_id) setStatus(e.content.task_id, "failed");
      }),
      // No `LoopStopped` / `LoopFinished` clear-the-cache subscribers
      // here: the live-task-ids signal now derives from
      // `useLoopActivityStore`, which clears itself when
      // `LoopActivityChanged` flips `current_task_id` to `None` or
      // `LoopEnded` removes the row entirely.
    ];
    return () => unsubs.forEach((u) => u());
  }, [projectId, subscribe]);

  return { tasks, tasksBySpec, liveTaskIds, loopActive };
}
