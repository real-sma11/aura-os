import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./AppNavRail.module.css";

export const TASKBAR_ICON_SIZE = 16;

export interface TaskbarIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  selected?: boolean;
  children?: ReactNode;
}

export function TaskbarIconButton({
  icon,
  selected = false,
  className,
  children,
  ...props
}: TaskbarIconButtonProps) {
  const cls = [styles.taskbarBtn, className ?? ""].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={cls}
      aria-pressed={selected}
      data-selected={selected || undefined}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
