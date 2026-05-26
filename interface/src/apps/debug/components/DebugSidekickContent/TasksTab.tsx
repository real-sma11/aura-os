import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { ProjectId } from "../../../../shared/types";
import { EmptyState } from "../../../../components/EmptyState";
import { useDebugRunMetadata } from "../../useDebugRunMetadata";
import styles from "./DebugSidekickContent.module.css";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function statusClass(status: string | null): string {
  if (!status) return styles.taskStatus;
  if (status === "task_completed") return `${styles.taskStatus} ${styles.taskStatusSuccess}`;
  if (status === "task_failed") return `${styles.taskStatus} ${styles.taskStatusFailed}`;
  return styles.taskStatus;
}

function statusLabel(status: string | null): string {
  if (!status) return "running";
  if (status === "task_completed") return "completed";
  if (status === "task_failed") return "failed";
  return status;
}

export function TasksTab() {
  const { projectId, runId } = useParams<{
    projectId: ProjectId;
    runId: string;
  }>();
  const { metadata } = useDebugRunMetadata(projectId, runId);
  const [filter, setFilter] = useState("");

  const tasks = useMemo(() => metadata?.tasks ?? [], [metadata]);
  const visibleTasks = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter((task) => {
      if (task.task_id.toLowerCase().includes(needle)) return true;
      if (task.task_name && task.task_name.toLowerCase().includes(needle)) {
        return true;
      }
      return false;
    });
  }, [tasks, filter]);

  if (!metadata) return <EmptyState>No run selected</EmptyState>;
  if (tasks.length === 0) {
    return <EmptyState>No tasks recorded on this run yet.</EmptyState>;
  }

  return (
    <div className={styles.taskPanel}>
      <div className={styles.taskFilterRow}>
        <input
          type="search"
          className={styles.taskFilterInput}
          placeholder="Filter by name or id"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter tasks by name or id"
        />
        <span className={styles.taskFilterCount}>
          {filter
            ? `${visibleTasks.length} / ${tasks.length}`
            : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {visibleTasks.length === 0 ? (
        <EmptyState>No tasks match the filter.</EmptyState>
      ) : (
        <div className={styles.taskList}>
          {visibleTasks.map((task) => {
            const name = task.task_name?.trim();
            return (
              <div key={task.task_id} className={styles.taskRow}>
                <div className={styles.taskRowHeader}>
                  <div className={styles.taskTitleStack}>
                    {name ? (
                      <span className={styles.taskName} title={name}>
                        {name}
                      </span>
                    ) : null}
                    <span className={styles.taskId} title={task.task_id}>
                      {task.task_id}
                    </span>
                  </div>
                  <span className={statusClass(task.status)}>
                    {statusLabel(task.status)}
                  </span>
                </div>
                <div className={styles.taskMeta}>
                  <span>started {formatDate(task.started_at)}</span>
                  {task.ended_at ? (
                    <span>· ended {formatDate(task.ended_at)}</span>
                  ) : null}
                </div>
                {task.spec_id ? (
                  <div className={styles.taskSpec}>spec {task.spec_id}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
