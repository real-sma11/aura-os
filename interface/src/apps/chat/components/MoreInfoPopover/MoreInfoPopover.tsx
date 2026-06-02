import { X } from "lucide-react";
import { CopyButton } from "../../../../components/CopyButton";
import type { MessageActionsMeta } from "../MessageActions/useMessageActions";
import styles from "./MoreInfoPopover.module.css";

export interface MoreInfoPopoverProps {
  meta: MessageActionsMeta;
  onClose: () => void;
}

/**
 * Presentational metadata panel for the action row's "More" affordance:
 * lists the Session ID, Project, and Workspace for the current chat.
 * Toggling, click-outside dismissal, and positioning are owned by the
 * parent `MessageActions` (mirroring the `ContextUsageIndicator`
 * popover structure); this component just renders the panel contents.
 */
export function MoreInfoPopover({ meta, onClose }: MoreInfoPopoverProps) {
  return (
    <div className={styles.panel} role="dialog" aria-label="Message details">
      <div className={styles.header}>
        <span className={styles.title}>Details</span>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.label}>Session ID</dt>
          <dd className={styles.value}>
            <span className={styles.mono}>{meta.sessionId ?? "—"}</span>
            {meta.sessionId && (
              <CopyButton
                getText={() => meta.sessionId ?? ""}
                ariaLabel="Copy session id"
                iconOnly
                className={styles.copy}
              />
            )}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Project</dt>
          <dd className={styles.value}>{meta.projectName || "—"}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Workspace</dt>
          <dd className={styles.value}>
            <span className={styles.mono}>{meta.workspacePath ?? "—"}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
