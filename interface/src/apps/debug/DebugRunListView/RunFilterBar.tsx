import { useMemo } from "react";
import type { DebugRunMetadata, DebugRunStatus } from "../../../shared/api/debug";
import { MultiSelectFilterMenu } from "./MultiSelectFilterMenu";
import type { MultiSelectFilterOption } from "./MultiSelectFilterMenu";
import styles from "./RunFilterBar.module.css";

/**
 * Active filter selections. Each `Set` holds the option ids
 * currently checked in the matching dropdown. Empty sets mean
 * "no filter on this facet".
 */
export interface RunFilterState {
  statuses: ReadonlySet<DebugRunStatus>;
  agents: ReadonlySet<string>;
  specs: ReadonlySet<string>;
  /** Selected `task_id`s. Filtering matches runs that include any selected task. */
  tasks: ReadonlySet<string>;
}

interface Props {
  /** All runs returned for the project (pre-filter), used to derive the agent/spec/task option lists. */
  runs: readonly DebugRunMetadata[];
  filters: RunFilterState;
  onToggleStatus: (status: DebugRunStatus) => void;
  onToggleAgent: (agentInstanceId: string) => void;
  onToggleSpec: (specId: string) => void;
  onToggleTask: (taskId: string) => void;
  onClearStatus: () => void;
  onClearAgent: () => void;
  onClearSpec: () => void;
  onClearTask: () => void;
  onClearAll: () => void;
}

const STATUS_OPTIONS: readonly MultiSelectFilterOption[] = [
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "interrupted", label: "Interrupted" },
];

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

/**
 * Multi-facet filter bar above the run list. URL search params are
 * the source of truth — this component is fully controlled and just
 * surfaces toggle/clear callbacks the parent wires into the params.
 */
export function RunFilterBar({
  runs,
  filters,
  onToggleStatus,
  onToggleAgent,
  onToggleSpec,
  onToggleTask,
  onClearStatus,
  onClearAgent,
  onClearSpec,
  onClearTask,
  onClearAll,
}: Props) {
  const agentOptions = useMemo<MultiSelectFilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      counts.set(
        run.agent_instance_id,
        (counts.get(run.agent_instance_id) ?? 0) + 1,
      );
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, count]) => ({
        id,
        label: shortId(id),
        hint: `${count}`,
      }));
  }, [runs]);

  const specOptions = useMemo<MultiSelectFilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      for (const specId of run.spec_ids ?? []) {
        counts.set(specId, (counts.get(specId) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, count]) => ({
        id,
        label: shortId(id),
        hint: `${count}`,
      }));
  }, [runs]);

  /**
   * Task options aggregate every distinct task observed across the
   * project's runs. The dropdown label prefers `task_name` (so users
   * recognize what they're filtering for) and uses the short task id
   * as the hint so both pieces of information are visible at once.
   * When no name is available we fall back to the id as the label.
   */
  const taskOptions = useMemo<MultiSelectFilterOption[]>(() => {
    const names = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const run of runs) {
      for (const task of run.tasks ?? []) {
        counts.set(task.task_id, (counts.get(task.task_id) ?? 0) + 1);
        const name = task.task_name?.trim();
        if (name && !names.has(task.task_id)) {
          names.set(task.task_id, name);
        }
      }
    }
    return Array.from(counts.entries())
      .sort(([idA], [idB]) => {
        const nameA = names.get(idA) ?? idA;
        const nameB = names.get(idB) ?? idB;
        return nameA.localeCompare(nameB);
      })
      .map(([id, count]) => {
        const name = names.get(id);
        return {
          id,
          label: name ?? shortId(id),
          hint: name ? `${shortId(id)} · ${count}` : `${count}`,
        };
      });
  }, [runs]);

  const totalSelected =
    filters.statuses.size +
    filters.agents.size +
    filters.specs.size +
    filters.tasks.size;

  return (
    <div className={styles.root}>
      <MultiSelectFilterMenu
        emptyLabel="All statuses"
        aria-label="Filter runs by status"
        selected={filters.statuses}
        options={STATUS_OPTIONS}
        onToggle={(id) => onToggleStatus(id as DebugRunStatus)}
        onClear={onClearStatus}
      />
      <MultiSelectFilterMenu
        emptyLabel="All tasks"
        aria-label="Filter runs by task"
        selected={filters.tasks}
        options={taskOptions}
        onToggle={onToggleTask}
        onClear={onClearTask}
        disabled={taskOptions.length === 0}
      />
      <MultiSelectFilterMenu
        emptyLabel="All agents"
        aria-label="Filter runs by agent instance"
        selected={filters.agents}
        options={agentOptions}
        onToggle={onToggleAgent}
        onClear={onClearAgent}
        disabled={agentOptions.length === 0}
      />
      <MultiSelectFilterMenu
        emptyLabel="All specs"
        aria-label="Filter runs by spec"
        selected={filters.specs}
        options={specOptions}
        onToggle={onToggleSpec}
        onClear={onClearSpec}
        disabled={specOptions.length === 0}
      />
      {totalSelected > 0 ? (
        <button
          type="button"
          className={styles.clearAll}
          onClick={onClearAll}
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
