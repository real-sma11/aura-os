import { useCallback, useEffect, useMemo } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  DebugRunMetadata,
  DebugRunStatus,
} from "../../../shared/api/debug";
import type { ProjectId } from "../../../shared/types";
import {
  clearLastDebugRunIf,
  getLastDebugRun,
  setLastDebugProject,
  setLastDebugRun,
} from "../../../utils/storage";
import { useDebugRuns } from "../useDebugRuns";
import styles from "./DebugRunListView.module.css";
import { RunFilterBar, type RunFilterState } from "./RunFilterBar";

const STATUS_PARAM = "status";
const AGENT_PARAM = "agent";
const SPEC_PARAM = "spec";

const VALID_STATUSES: readonly DebugRunStatus[] = [
  "running",
  "completed",
  "failed",
  "interrupted",
];
const VALID_STATUS_SET = new Set<string>(VALID_STATUSES);

function badgeClass(status: DebugRunStatus): string {
  switch (status) {
    case "running":
      return `${styles.badge} ${styles.badgeRunning}`;
    case "completed":
      return `${styles.badge} ${styles.badgeCompleted}`;
    case "failed":
      return `${styles.badge} ${styles.badgeFailed}`;
    case "interrupted":
      return `${styles.badge} ${styles.badgeInterrupted}`;
    default:
      return styles.badge;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDuration(run: DebugRunMetadata): string {
  const startedAt = run.started_at ? new Date(run.started_at).getTime() : NaN;
  const endedAt = run.ended_at
    ? new Date(run.ended_at).getTime()
    : Date.now();
  if (Number.isNaN(startedAt)) return "—";
  const ms = Math.max(0, endedAt - startedAt);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function parseCsvParam(value: string | null): Set<string> {
  if (!value) return new Set();
  return new Set(value.split(",").filter((entry) => entry.length > 0));
}

function toggleInSet(values: Set<string>, id: string): Set<string> {
  const next = new Set(values);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function writeCsvParam(
  params: URLSearchParams,
  key: string,
  values: ReadonlySet<string>,
): void {
  if (values.size === 0) {
    params.delete(key);
    return;
  }
  params.set(key, Array.from(values).join(","));
}

export function DebugRunListView() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: ProjectId }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<RunFilterState>(() => {
    const rawStatus = parseCsvParam(searchParams.get(STATUS_PARAM));
    const validStatuses = new Set<DebugRunStatus>();
    for (const entry of rawStatus) {
      if (VALID_STATUS_SET.has(entry)) {
        validStatuses.add(entry as DebugRunStatus);
      }
    }
    return {
      statuses: validStatuses,
      agents: parseCsvParam(searchParams.get(AGENT_PARAM)),
      specs: parseCsvParam(searchParams.get(SPEC_PARAM)),
    };
  }, [searchParams]);

  // Server-side spec filter is only safe when exactly one spec is
  // selected — otherwise we fetch the full set and filter client-side.
  const serverSpecFilter =
    filters.specs.size === 1
      ? (filters.specs.values().next().value as string)
      : undefined;
  const { runs, isLoading, error } = useDebugRuns(projectId, serverSpecFilter);

  const visibleRuns = useMemo(() => {
    if (
      filters.statuses.size === 0 &&
      filters.agents.size === 0 &&
      filters.specs.size === 0
    ) {
      return runs;
    }
    return runs.filter((run) => {
      if (filters.statuses.size > 0 && !filters.statuses.has(run.status)) {
        return false;
      }
      if (
        filters.agents.size > 0 &&
        !filters.agents.has(run.agent_instance_id)
      ) {
        return false;
      }
      if (filters.specs.size > 0) {
        const specIds = run.spec_ids ?? [];
        const hit = specIds.some((id) => filters.specs.has(id));
        if (!hit) return false;
      }
      return true;
    });
  }, [runs, filters]);

  useEffect(() => {
    if (projectId) setLastDebugProject(projectId);
  }, [projectId]);

  // Drop any remembered "last run" for this project once the run list
  // has loaded and the stored run is no longer present (e.g. deleted
  // on disk). This keeps the Debug index redirect from repeatedly
  // landing on a 404 run detail.
  useEffect(() => {
    if (!projectId) return;
    if (isLoading) return;
    if (runs.length === 0) return;
    const remembered = getLastDebugRun(projectId);
    if (!remembered) return;
    const knownRunIds = new Set(runs.map((run) => run.run_id));
    if (!knownRunIds.has(remembered)) {
      clearLastDebugRunIf({ projectId, runId: remembered });
    }
  }, [projectId, runs, isLoading]);

  const updateFilterParam = useCallback(
    (key: string, next: ReadonlySet<string>) => {
      const params = new URLSearchParams(searchParams);
      writeCsvParam(params, key, next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const onToggleStatus = useCallback(
    (status: DebugRunStatus) => {
      updateFilterParam(STATUS_PARAM, toggleInSet(new Set(filters.statuses), status));
    },
    [filters.statuses, updateFilterParam],
  );

  const onToggleAgent = useCallback(
    (agentInstanceId: string) => {
      updateFilterParam(
        AGENT_PARAM,
        toggleInSet(new Set(filters.agents), agentInstanceId),
      );
    },
    [filters.agents, updateFilterParam],
  );

  const onToggleSpec = useCallback(
    (specId: string) => {
      updateFilterParam(SPEC_PARAM, toggleInSet(new Set(filters.specs), specId));
    },
    [filters.specs, updateFilterParam],
  );

  const clearStatus = useCallback(
    () => updateFilterParam(STATUS_PARAM, new Set()),
    [updateFilterParam],
  );
  const clearAgent = useCallback(
    () => updateFilterParam(AGENT_PARAM, new Set()),
    [updateFilterParam],
  );
  const clearSpec = useCallback(
    () => updateFilterParam(SPEC_PARAM, new Set()),
    [updateFilterParam],
  );

  const clearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete(STATUS_PARAM);
    params.delete(AGENT_PARAM);
    params.delete(SPEC_PARAM);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const anyFilterActive =
    filters.statuses.size > 0 ||
    filters.agents.size > 0 ||
    filters.specs.size > 0;

  if (!projectId) {
    return <div className={styles.empty}>No project selected.</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{projectId}</h2>
          <div className={styles.subtitle}>
            {anyFilterActive
              ? `Showing ${visibleRuns.length} of ${runs.length} run${runs.length === 1 ? "" : "s"}`
              : `${visibleRuns.length} run${visibleRuns.length === 1 ? "" : "s"}`}
          </div>
        </div>
      </div>
      <div className={styles.filterBar}>
        <RunFilterBar
          runs={runs}
          filters={filters}
          onToggleStatus={onToggleStatus}
          onToggleAgent={onToggleAgent}
          onToggleSpec={onToggleSpec}
          onClearStatus={clearStatus}
          onClearAgent={clearAgent}
          onClearSpec={clearSpec}
          onClearAll={clearAll}
        />
      </div>
      {isLoading && visibleRuns.length === 0 ? (
        <div className={styles.empty}>Loading runs…</div>
      ) : error ? (
        <div className={styles.empty}>
          Failed to load runs: {String((error as Error).message ?? error)}
        </div>
      ) : visibleRuns.length === 0 ? (
        <div className={styles.empty}>
          {anyFilterActive
            ? "No runs match the active filters."
            : "No runs recorded for this project."}
        </div>
      ) : (
        <div className={styles.grid}>
          {visibleRuns.map((run) => (
            <button
              key={run.run_id}
              type="button"
              className={styles.card}
              onClick={() => {
                setLastDebugRun(projectId, run.run_id);
                navigate(`/debug/${projectId}/runs/${run.run_id}`);
              }}
            >
              <span className={badgeClass(run.status)}>{run.status}</span>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}>
                  {formatDate(run.started_at)}
                </div>
                <div className={styles.cardMeta}>
                  <span>{formatDuration(run)}</span>
                  <span>{run.counters.llm_calls} llm calls</span>
                  <span>{run.counters.iterations} iter</span>
                  <span>{run.counters.blockers} blockers</span>
                  <span>{run.counters.retries} retries</span>
                </div>
              </div>
              <span className={styles.cardMeta}>
                <span title={run.run_id}>{run.run_id.slice(0, 8)}…</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
