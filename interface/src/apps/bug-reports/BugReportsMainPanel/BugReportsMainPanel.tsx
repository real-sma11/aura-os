import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Info, ShieldAlert } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { Select } from "../../../components/Select/Select";
import { useIsSysAdmin } from "../../../stores/auth-store";
import {
  useBugReportsBootstrap,
  useBugReportsStore,
  useSelectedBugReport,
} from "../../../stores/bug-reports-store";
import { useProjectsList } from "../../projects/useProjectsList";
import { bugReportsApi, type BugReportDto } from "../../../api/bug-reports";
import { tasksApi } from "../../../shared/api/tasks";
import { timeAgo } from "../../../shared/utils/format";
import styles from "./BugReportsMainPanel.module.css";

function formatCreatedAt(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const formatted = date.toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return `${formatted} (${timeAgo(iso)})`;
  } catch {
    return iso;
  }
}

function formatDiagnostics(diagnostics: unknown): string {
  try {
    return JSON.stringify(diagnostics, null, 2);
  } catch {
    return String(diagnostics);
  }
}

interface LinkedTask {
  taskId: string;
  status: string;
  projectId: string;
}

function FixTaskSection({ report }: { report: BugReportDto }) {
  const { projects, refreshProjects } = useProjectsList();
  const reloadReports = useBugReportsStore((s) => s.loadItems);
  const [projectId, setProjectId] = useState(report.linkedProjectId ?? "");
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkedTask, setLinkedTask] = useState<LinkedTask | null>(
    report.linkedTaskId && report.linkedProjectId
      ? {
          taskId: report.linkedTaskId,
          status: report.status,
          projectId: report.linkedProjectId,
        }
      : null,
  );

  useEffect(() => {
    if (projects.length === 0) void refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = useMemo(
    () => projects.map((p) => ({ value: p.project_id, label: p.name })),
    [projects],
  );

  const handleCreate = async () => {
    if (!projectId || creating || linkedTask) return;
    setCreating(true);
    setError(null);
    try {
      const res = await bugReportsApi.createFixTask(report.id, { projectId });
      setLinkedTask({
        taskId: res.task.task_id,
        status: res.task.status,
        projectId: res.projectId,
      });
      void reloadReports();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create fix task.",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRun = async () => {
    if (!linkedTask || running) return;
    setRunning(true);
    setError(null);
    try {
      await tasksApi.runTask(linkedTask.projectId, linkedTask.taskId);
      setLinkedTask((prev) =>
        prev ? { ...prev, status: "in_progress" } : prev,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start the fix task.",
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className={styles.section} aria-label="Fix task">
      <h3 className={styles.sectionHeading}>Fix task</h3>
      <div className={styles.fixTaskControls}>
        <Select
          value={projectId}
          onChange={setProjectId}
          options={options}
          placeholder="Select a project"
          disabled={creating || linkedTask !== null}
          className={styles.fixTaskSelect}
        />
        <button
          type="button"
          className={styles.fixTaskButton}
          onClick={handleCreate}
          disabled={!projectId || creating || linkedTask !== null}
        >
          {creating ? "Creating…" : "Create fix task"}
        </button>
        <button
          type="button"
          className={styles.fixTaskButton}
          onClick={handleRun}
          disabled={linkedTask === null || running}
        >
          {running ? "Starting…" : "Run now"}
        </button>
      </div>
      {linkedTask && (
        <p className={styles.fixTaskStatus}>
          Linked task <code className={styles.fixTaskId}>{linkedTask.taskId}</code>
          {" · "}
          {linkedTask.status}
        </p>
      )}
      {error && <p className={styles.fixTaskError}>{error}</p>}
    </section>
  );
}

export function BugReportsMainPanel() {
  useBugReportsBootstrap();
  const isSysAdmin = useIsSysAdmin();
  const report = useSelectedBugReport();
  const scrollRef = useRef<HTMLDivElement>(null);

  const diagnosticsText = useMemo(
    () => (report ? formatDiagnostics(report.diagnostics) : ""),
    [report],
  );

  if (!isSysAdmin) {
    return (
      <EmptyState icon={<ShieldAlert size={32} />}>
        This view is restricted to administrators.
      </EmptyState>
    );
  }

  if (!report) {
    return (
      <EmptyState icon={<Info size={32} />}>
        Select a bug report to view its diagnostics
      </EmptyState>
    );
  }

  return (
    <div className={styles.panel} aria-label="Bug report details">
      <div ref={scrollRef} className={styles.scroll}>
        <div className={styles.body}>
          <h2 className={styles.title}>
            {report.description.split("\n")[0] || "Untitled report"}
          </h2>

          <dl className={styles.metaList}>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Submitter</dt>
              <dd className={styles.metaValue}>
                {report.displayName || "Unknown"}
              </dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Created</dt>
              <dd className={styles.metaValue}>
                {formatCreatedAt(report.createdAt)}
              </dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Status</dt>
              <dd className={styles.metaValue}>{report.status}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Category</dt>
              <dd className={styles.metaValue}>{report.category || "—"}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Severity</dt>
              <dd className={styles.metaValue}>{report.severity || "—"}</dd>
            </div>
          </dl>

          <section className={styles.section} aria-label="Description">
            <h3 className={styles.sectionHeading}>Description</h3>
            <p className={styles.description}>
              {report.description || "No description provided."}
            </p>
          </section>

          <section className={styles.section} aria-label="Analysis">
            <h3 className={styles.sectionHeading}>Analysis</h3>
            {report.llmSummary ? (
              <div className={styles.markdown}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {report.llmSummary}
                </ReactMarkdown>
              </div>
            ) : (
              <p className={styles.description}>No analysis available.</p>
            )}
          </section>

          <section className={styles.section} aria-label="Diagnostics">
            <h3 className={styles.sectionHeading}>Diagnostics</h3>
            <pre className={styles.diagnostics}>{diagnosticsText}</pre>
          </section>

          <FixTaskSection report={report} />
        </div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
