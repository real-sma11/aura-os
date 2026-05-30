import type { ReactNode } from "react";
import { ConnectionDot } from "../ConnectionDot";
import { useConnectionStatus } from "../ConnectionDot/useConnectionStatus";
import { ReportBugButton } from "../ReportBugButton";
import styles from "./ConnectionTaskbar.module.css";

export function ConnectionTaskbar({ children }: { children?: ReactNode }) {
  const { connected } = useConnectionStatus();
  return (
    <div className={styles.taskbar}>
      <div className={styles.status}>
        <ConnectionDot />
        {!connected && (
          <ReportBugButton compact titleSuffix="connection lost" />
        )}
      </div>
      {children}
    </div>
  );
}
