import { memo, useState } from "react";
import { ChevronDown, Pencil, ArrowUp, ArrowRight, Trash2 } from "lucide-react";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useMessageQueue } from "../../../stores/message-queue-store";
import type { QueuedMessage } from "../../../stores/message-queue-store";
import styles from "./MessageQueue.module.css";

interface Props {
  streamKey: string;
  onEdit: (item: QueuedMessage) => void;
  onMoveUp: (id: string) => void;
  onRemove: (id: string) => void;
  /**
   * Cancel the in-flight turn and immediately send this queued
   * prompt. The button is only rendered when a stream is currently
   * active for `streamKey`; without an active turn the regular
   * dequeue-on-completion path picks the head item up on its own.
   */
  onSendNow?: (item: QueuedMessage) => void;
}

export const MessageQueue = memo(function MessageQueue({
  streamKey,
  onEdit,
  onMoveUp,
  onRemove,
  onSendNow,
}: Props) {
  const queue = useMessageQueue(streamKey);
  const isStreaming = useIsStreaming(streamKey);
  const [collapsed, setCollapsed] = useState(false);

  if (queue.length === 0) return null;

  return (
    <div className={styles.queueContainer}>
      <div
        className={styles.queueHeader}
        onClick={() => setCollapsed((v) => !v)}
      >
        <ChevronDown
          size={14}
          className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ""}`}
        />
        <span className={styles.queueCount}>
          {queue.length} Queued
        </span>
      </div>

      {!collapsed && (
        <div className={styles.queueList}>
          {queue.map((item, idx) => (
            <div key={item.id} className={styles.queueItem}>
              <span className={styles.queueIndicator} />
              <span className={styles.queueItemText}>{item.content}</span>
              <div className={styles.queueActions}>
                {onSendNow && isStreaming && (
                  <button
                    type="button"
                    className={`${styles.queueActionBtn} ${styles.queueActionBtnAccent}`}
                    onClick={() => onSendNow(item)}
                    aria-label="Send now (cancels current turn)"
                    title="Send now (cancels current turn)"
                  >
                    <ArrowRight size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.queueActionBtn}
                  onClick={() => onEdit(item)}
                  aria-label="Edit message"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className={styles.queueActionBtn}
                  onClick={() => onMoveUp(item.id)}
                  disabled={idx === 0}
                  aria-label="Move up"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  className={styles.queueActionBtn}
                  onClick={() => onRemove(item.id)}
                  aria-label="Remove from queue"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
