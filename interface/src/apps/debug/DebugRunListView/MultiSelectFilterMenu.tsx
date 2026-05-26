import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { useClickOutside } from "../../../shared/hooks/use-click-outside";
import styles from "./MultiSelectFilterMenu.module.css";

export interface MultiSelectFilterOption {
  id: string;
  label: string;
  hint?: string;
}

interface Props {
  /** Static label used when the selection is empty (e.g. "All statuses"). */
  emptyLabel: string;
  /** Selected option ids. Order is irrelevant. */
  selected: ReadonlySet<string>;
  options: readonly MultiSelectFilterOption[];
  onToggle: (id: string) => void;
  onClear: () => void;
  "aria-label"?: string;
  /** Minimum dropdown width in pixels (default 220). */
  menuWidth?: number;
  /**
   * When the option list is empty we render a non-interactive trigger
   * so the bar layout stays stable across projects (e.g. before any
   * run has populated the spec list).
   */
  disabled?: boolean;
}

/**
 * Portaled multi-select dropdown used by the run filter bar. Modeled
 * on `DebugFilterMenu` but keeps the menu open across clicks, renders
 * a per-row checkmark, and shows a "X selected" / first-label summary
 * in the trigger so users can tell what's active without opening it.
 */
export function MultiSelectFilterMenu({
  emptyLabel,
  selected,
  options,
  onToggle,
  onClear,
  "aria-label": ariaLabel,
  menuWidth = 220,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside([triggerRef, menuRef], () => setOpen(false), open);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left });
  }, [open]);

  const triggerLabel = (() => {
    if (selected.size === 0) return emptyLabel;
    if (selected.size === 1) {
      const onlyId = selected.values().next().value as string;
      const match = options.find((option) => option.id === onlyId);
      return match?.label ?? onlyId;
    }
    return `${emptyLabel} (${selected.size})`;
  })();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${selected.size > 0 ? styles.triggerActive : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel ?? emptyLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        {selected.size > 0 ? (
          <span
            role="button"
            tabIndex={0}
            className={styles.clearAffordance}
            aria-label={`Clear ${emptyLabel}`}
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onClear();
              }
            }}
          >
            <X size={12} aria-hidden />
          </span>
        ) : (
          <ChevronDown size={12} aria-hidden />
        )}
      </button>
      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.menuPortal}
              style={{ top: rect.top, left: rect.left, minWidth: menuWidth }}
              role="menu"
            >
              {options.length === 0 ? (
                <div className={styles.empty}>No options available</div>
              ) : (
                options.map((option) => {
                  const isSelected = selected.has(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={isSelected}
                      className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
                      onClick={() => onToggle(option.id)}
                    >
                      <span className={styles.checkSlot}>
                        {isSelected ? <Check size={12} aria-hidden /> : null}
                      </span>
                      <span className={styles.rowLabel}>{option.label}</span>
                      {option.hint ? (
                        <span className={styles.rowHint}>{option.hint}</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
