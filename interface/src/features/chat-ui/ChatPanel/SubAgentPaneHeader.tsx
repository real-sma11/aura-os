import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@cypher-asi/zui";
import type { SubagentState } from "../../../shared/types/harness-protocol";
import { subagentTypeLabel } from "../../../constants/tools";
import {
  subagentBadgeVariant,
  subagentStateLabel,
} from "../../../shared/utils/subagent";
import styles from "./SubAgentPaneHeader.module.css";

export interface SubAgentPaneHeaderProps {
  /** Parent agent name, rendered as the breadcrumb root. */
  agentName?: string;
  /** Subagent kind (e.g. `explore`) shown after the chevron. */
  subagentType: string;
  /** Authoritative lifecycle state for the status pill. */
  state: SubagentState;
  /** Failure / rejection detail surfaced under the title when present. */
  reason?: string;
  /** Pop the sub-pane and return to the parent thread. */
  onBack: () => void;
}

/**
 * iOS-style push-navigation title bar for the subagent sub-pane. Shows
 * `Agent Name -> Subagent` with a back chevron that returns to the
 * parent thread, plus a live status pill. Sits at the top of the reused
 * `ChatPanel` surface in place of the project/agent bar so the subagent
 * view is visually identical to the main chat with only this bar added.
 */
export function SubAgentPaneHeader({
  agentName,
  subagentType,
  state,
  reason,
  onBack,
}: SubAgentPaneHeaderProps) {
  const label = subagentTypeLabel(subagentType);
  const showReason =
    !!reason && (state === "failed" || state === "rejected" || state === "cancelled");

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
          aria-label="Back to parent thread"
        >
          <ChevronLeft size={16} />
        </button>
        <div className={styles.breadcrumb}>
          {agentName ? (
            <button
              type="button"
              className={styles.parentLink}
              onClick={onBack}
            >
              {agentName}
            </button>
          ) : (
            <span className={styles.parentLink}>Agent</span>
          )}
          <ChevronRight size={13} className={styles.sep} aria-hidden />
          <span className={styles.current}>{label}</span>
        </div>
        <Badge variant={subagentBadgeVariant(state)} pulse={state === "running"}>
          {subagentStateLabel(state)}
        </Badge>
      </div>
      {showReason && <p className={styles.reason}>{reason}</p>}
    </div>
  );
}
