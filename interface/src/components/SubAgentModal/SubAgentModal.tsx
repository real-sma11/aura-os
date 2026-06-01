import { Modal, Badge, Spinner, Text } from "@cypher-asi/zui";
import type { SubagentState } from "../../shared/types/harness-protocol";
import { subagentTypeLabel } from "../../constants/tools";
import {
  subagentBadgeVariant,
  subagentStateLabel,
} from "../../shared/utils/subagent";
import {
  useSubagentChatStream,
  subagentStreamKey,
} from "../../hooks/use-subagent-chat-stream";
import { useStreamEvents, useIsStreaming } from "../../hooks/stream/hooks";
import { ChatPanel } from "../../features/chat-ui/ChatPanel";
import styles from "./SubAgentModal.module.css";

const SUBAGENT_SEND_DISABLED_REASON =
  "Subagent threads are read-only — you can watch the run but cannot send messages into it.";
const SUBAGENT_EMPTY_MESSAGE = "This subagent has not produced any output yet.";

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

// Stable no-op handlers. The subagent attach endpoint is read-only —
// there is no server path to send a message into (or stop) a child run
// from here — so the reused `ChatPanel` runs with its input disabled.
// See `useSubagentChatStream` and the `sendDisabled` ChatPanel prop.
const noopSend = (): void => {};
const noopStop = (): void => {};

/**
 * Floating modal that surfaces a subagent child run as a full
 * chat-within-a-chat by reusing the main `ChatPanel` pointed at the
 * run's stream-store partition (`subagent:{childRunId}`). Persistence,
 * live streaming, scroll/auto-follow, and tool/activity rendering all
 * come "for free" from the same store pipeline the top-level chat uses,
 * so the transcript survives closing and reopening the modal. Sending
 * is disabled because the child run has no inbound message path.
 */
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
  const { status } = useSubagentChatStream(childRunId, parentToolUseId, isOpen);
  const streamKey = subagentStreamKey(childRunId);
  const events = useStreamEvents(streamKey);
  const isStreaming = useIsStreaming(streamKey);

  const hasTranscript = events.length > 0;
  const isConnecting = status === "attaching" && !hasTranscript && !isStreaming;
  // A finished run whose harness session was already reaped fails the
  // attach with no transcript. Surface that as a calm empty state rather
  // than a connection-error banner — there's simply nothing left to tail.
  const threadUnavailable = status === "error" && !hasTranscript;
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
      <div className={styles.body}>
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
        ) : threadUnavailable ? (
          <div className={styles.center}>
            <Text variant="muted" size="sm">
              This subagent thread is no longer available.
            </Text>
            <Text variant="muted" size="sm">
              Its live transcript was cleaned up after the run finished.
            </Text>
          </div>
        ) : (
          <div className={styles.chat}>
            <ChatPanel
              streamKey={streamKey}
              transcriptKey={streamKey}
              onSend={noopSend}
              onStop={noopStop}
              historyResolved
              focusInputOnThreadReady={false}
              emptyMessage={SUBAGENT_EMPTY_MESSAGE}
              sendDisabled
              sendDisabledReason={SUBAGENT_SEND_DISABLED_REASON}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
