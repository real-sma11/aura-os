import { memo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./InputBarShell.module.css";

export interface ModelMenuGroupProps {
  /** Vendor section label shown in the header (e.g. "Anthropic"). */
  label: string;
  /** Whether the section is collapsed (children hidden). */
  collapsed: boolean;
  /** Toggle the collapsed state. */
  onToggle: () => void;
  /** Model rows rendered when the section is expanded. */
  children: ReactNode;
  /** Override for the group wrapper (e.g. mobile rounded chrome). */
  className?: string;
  /** Override for the header button (e.g. mobile sizing). */
  headerClassName?: string;
  /** Override for the label text (e.g. mobile typography). */
  labelClassName?: string;
}

/**
 * One collapsible vendor section of the chat model picker. Purely
 * presentational: the parent owns the collapsed state and supplies the
 * model rows as `children`, so the same section chrome is reused by the
 * desktop and mobile input bars without either knowing about stores or
 * routing.
 *
 * The header is a real `<button>` with `aria-expanded` for keyboard /
 * screen-reader support; the chevron is decorative and rotates via a
 * CSS class. No `onMouseDown` handler is needed here — the surrounding
 * `ModelPicker` portal already calls `preventDefault` on bubbled
 * mousedown so the chat textarea keeps focus.
 */
export const ModelMenuGroup = memo(function ModelMenuGroup({
  label,
  collapsed,
  onToggle,
  children,
  className,
  headerClassName,
  labelClassName,
}: ModelMenuGroupProps) {
  const wrapperClass = [styles.modelMenuGroup, className]
    .filter(Boolean)
    .join(" ");
  const headerClass = [styles.modelMenuGroupHeader, headerClassName]
    .filter(Boolean)
    .join(" ");
  const labelClass = [styles.modelMenuGroupLabel, labelClassName]
    .filter(Boolean)
    .join(" ");
  const chevronClass = [
    styles.modelMenuGroupChevron,
    collapsed ? styles.modelMenuGroupChevronCollapsed : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClass} data-model-menu-root="true">
      <button
        type="button"
        className={headerClass}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className={labelClass}>{label}</span>
        <ChevronDown size={12} aria-hidden className={chevronClass} />
      </button>
      {collapsed ? null : children}
    </div>
  );
});
