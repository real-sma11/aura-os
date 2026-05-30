import { useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useIsSysAdmin } from "../../../stores/auth-store";
import {
  useBugReports,
  useBugReportsBootstrap,
} from "../../../stores/bug-reports-store";
import { timeAgo } from "../../../shared/utils/format";
import styles from "./BugReportsList.module.css";

function emptyMessage(
  isPending: boolean,
  loadError: string | null,
): string {
  if (isPending) return "Loading bug reports...";
  if (loadError) return `Could not load bug reports: ${loadError}`;
  return "No bug reports yet.";
}

export function BugReportsList() {
  useBugReportsBootstrap();
  const isSysAdmin = useIsSysAdmin();
  const { items, selectedId, selectItem, isLoading, hasLoaded, loadError } =
    useBugReports();
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!isSysAdmin) {
    return (
      <EmptyState icon={<ShieldAlert size={32} />}>
        This view is restricted to administrators.
      </EmptyState>
    );
  }

  const isPending = isLoading || !hasLoaded;

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.list}>
        {items.length === 0 ? (
          <div className={styles.emptyWrapper}>
            <EmptyState icon={<ShieldAlert size={32} />}>
              {emptyMessage(isPending, loadError)}
            </EmptyState>
          </div>
        ) : (
          items.map((report) => {
            const isSelected = report.id === selectedId;
            return (
              <button
                key={report.id}
                type="button"
                className={`${styles.row} ${isSelected ? styles.rowActive : ""}`}
                aria-pressed={isSelected}
                onClick={() => selectItem(report.id)}
              >
                <span className={styles.rowHeader}>
                  <span className={styles.rowTitle}>
                    {report.description.split("\n")[0] || "Untitled report"}
                  </span>
                  <span
                    className={styles.statusTag}
                    data-status={report.status}
                  >
                    {report.status}
                  </span>
                </span>
                <span className={styles.rowMeta}>
                  <span className={styles.rowSubmitter}>
                    {report.displayName || "Unknown"}
                  </span>
                  <span className={styles.rowSeparator}>&middot;</span>
                  <span className={styles.rowTime}>
                    {timeAgo(report.createdAt)}
                  </span>
                  {report.severity ? (
                    <>
                      <span className={styles.rowSeparator}>&middot;</span>
                      <span className={styles.rowSeverity}>
                        {report.severity}
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
