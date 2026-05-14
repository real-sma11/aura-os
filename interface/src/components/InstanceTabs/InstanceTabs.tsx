import { X, Plus } from "lucide-react";
import styles from "./InstanceTabs.module.css";

export interface InstanceTab {
  id: string;
  title: string;
}

export interface InstanceTabsProps {
  tabs: InstanceTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  /** aria-label for the trailing "+" button. */
  addAriaLabel: string;
}

/**
 * Generic horizontal tab strip used for sidekick instance panes
 * (browser sessions, terminal sessions, ...). Always renders the
 * strip (even with one tab) so the inline `+` is always available.
 */
export function InstanceTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onAdd,
  addAriaLabel,
}: InstanceTabsProps) {
  return (
    <div className={styles.root} role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div key={tab.id} className={styles.tabWrap}>
            <button
              type="button"
              role="tab"
              aria-current={active ? "page" : undefined}
              aria-selected={active}
              className={styles.tab}
              onClick={() => onActivate(tab.id)}
            >
              <span className={styles.title}>{tab.title}</span>
            </button>
            <button
              type="button"
              className={styles.close}
              aria-label={`Close ${tab.title}`}
              onClick={() => onClose(tab.id)}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={styles.addButton}
        aria-label={addAriaLabel}
        onClick={onAdd}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
