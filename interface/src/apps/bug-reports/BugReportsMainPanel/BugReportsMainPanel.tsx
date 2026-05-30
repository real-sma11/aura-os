import { useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Info, ShieldAlert } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useIsSysAdmin } from "../../../stores/auth-store";
import {
  useBugReportsBootstrap,
  useSelectedBugReport,
} from "../../../stores/bug-reports-store";
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
        </div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
