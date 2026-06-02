import type { ReactElement, ReactNode } from "react";
import styles from "./TaskbarShell.module.css";

export interface TaskbarShellProps {
  children: ReactNode;
}

/**
 * Wraps the entire bottom taskbar section (the `.bar` and all its pills).
 * Spans the full width and reaches the bottom edge of the shell, painting
 * the diagonal background gradient behind the floating taskbar pills.
 */
export function TaskbarShell({ children }: TaskbarShellProps): ReactElement {
  return <div className={styles.taskbarShell}>{children}</div>;
}
