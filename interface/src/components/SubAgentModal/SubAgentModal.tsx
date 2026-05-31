import { useRef } from "react";
import { Modal, Badge, Spinner, Text } from "@cypher-asi/zui";
import type { SubagentState } from "../../shared/types/harness-protocol";
import { subagentTypeLabel } from "../../constants/tools";
import {
  subagentBadgeVariant,
  subagentStateLabel,
} from "../../shared/utils/subagent";
import { useSubagentThread } from "../../hooks/use-subagent-thread";
import { ActivityTimeline } from "../ActivityTimeline";
import styles from "./SubAgentModal.module.css";

export interface SubAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Child run id to attach to. Required to open a live thread. */
  childRunId: string;
  /** Originating `task` tool-use id, forwarded to the attach endpoint. */
  parentToolUseId?: string;
  /** Subagent kind for the modal title (e.g. `explore`). */
  subagentType: string;
  /** Spawn prompt, rendered as the modal subtitle. */
  prompt: string;
  /**
   * Lifecycle state resolved from the parent stream / tool result. Used
   * for the header pill so it reflects the authoritative status even
   * before the child SSE reaches its own terminal frame.
   */
  state: SubagentState;
  /** Failure / rejection detail, shown when the run did not complete. */
  reason?: string;
}

export function SubAgentModal({
  isOpen,
  onClose,
  childRunId,
  parentToolUseId,
  subagentType,
  prompt,
  state,
  reason,
}: SubAgentModalProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const view = useSubagentThread(childRunId, parentToolUseId, isOpen);

  const hasTranscript = view.timeline.length > 0;
  const isConnecting = view.status === "attaching" && !hasTranscript;
  const showFailureReason =
    !!reason && (state === "failed" || state === "rejected" || state === "cancelled");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={subagentTypeLabel(subagentType)}
      subtitle={prompt || undefined}
      size="lg"
      fullHeight
      headerActions={
        <Badge variant={subagentBadgeVariant(state)} pulse={state === "running"}>
          {subagentStateLabel(state)}
        </Badge>
      }
    >
      <div className={styles.body} ref={scrollRef}>
        {showFailureReason && (
          <Text variant="muted" size="sm" className={styles.reason}>
            {reason}
          </Text>
        )}
        {isConnecting ? (
          <div className={styles.center}>
            <Spinner size="md" />
            <Text variant="muted" size="sm">
              Connecting to subagent…
            </Text>
          </div>
        ) : (
          <ActivityTimeline
            timeline={view.timeline}
            thinkingText={view.thinkingText}
            thinkingDurationMs={view.thinkingDurationMs}
            toolCalls={view.toolCalls}
            isStreaming={view.isStreaming}
            defaultActivitiesExpanded
            scrollRef={scrollRef}
          />
        )}
        {view.status === "error" && (
          <Text variant="muted" size="sm" className={styles.error}>
            {view.errorMessage ?? "Lost connection to the subagent thread."}
          </Text>
        )}
        {!isConnecting && !hasTranscript && view.status !== "error" && (
          <Text variant="muted" size="sm" className={styles.center}>
            This subagent has not produced any output yet.
          </Text>
        )}
      </div>
    </Modal>
  );
}
