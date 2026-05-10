import { useMemo, useRef } from "react";
import { Info } from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useAuthStore } from "../../../stores/auth-store";
import {
  useFeedback,
  useFeedbackComments,
  useFeedbackItem,
} from "../../../stores/feedback-store";
import { timeAgo } from "../../../shared/utils/format";
import {
  categoryLabel,
  productLabel,
  statusLabel,
  type FeedbackStatus,
} from "../types";
import styles from "./FeedbackDetailsPanel.module.css";

/** Statuses the submitting author can flip their own feedback to from the
 *  Details panel. The current status is prepended (and deduped) so the
 *  `<select>` always has its current value as an option. */
const AUTHOR_STATUS_TARGETS: readonly FeedbackStatus[] = [
  "not_started",
  "done",
  "deployed",
];

function formatCreatedAt(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const formatted = date.toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return `${formatted} (${timeAgo(iso)})`;
  } catch {
    return iso;
  }
}

/**
 * Read-only details surface for the currently selected feedback item. Sits
 * behind the Details tab in the sidekick and exposes everything the feed
 * card hides — full title, full description (no clamping), author identity,
 * category/status/product, vote totals, and creation timestamp.
 */
export function FeedbackDetailsPanel() {
  const { selectedId, setStatus } = useFeedback();
  const item = useFeedbackItem(selectedId);
  const comments = useFeedbackComments(selectedId);
  const viewerProfileId = useAuthStore((s) => s.user?.profile_id);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isAuthor =
    !!viewerProfileId &&
    !!item?.author.profileId &&
    viewerProfileId === item.author.profileId;

  const sortedComments = useMemo(
    () =>
      [...comments].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [comments],
  );

  const statusOptions = useMemo<readonly FeedbackStatus[]>(() => {
    if (!item) return AUTHOR_STATUS_TARGETS;
    const rest = AUTHOR_STATUS_TARGETS.filter((s) => s !== item.status);
    return [item.status, ...rest];
  }, [item]);

  if (!item) {
    return (
      <EmptyState icon={<Info size={32} />}>
        Select a feedback item to view details
      </EmptyState>
    );
  }

  return (
    <div
      className={styles.panel}
      data-demo-shot="feedback-sidekick-details"
      data-agent-surface="feedback-details"
      data-agent-context="feedback-details"
      data-agent-context-anchor="feedback-details-panel"
      data-agent-item-id={item.id}
      data-agent-item-title={item.title}
      aria-label={`Feedback details for ${item.title || "Untitled"}`}
    >
      <div ref={scrollRef} className={styles.scroll}>
        <div className={styles.body}>
          <h2 className={styles.title}>{item.title || "Untitled"}</h2>
          <div className={styles.authorRow}>
            <Avatar
              avatarUrl={item.author.avatarUrl}
              name={item.author.name}
              type={item.author.type}
              size={28}
            />
            <div className={styles.authorMeta}>
              <span className={styles.authorName}>{item.author.name}</span>
              <span className={styles.createdAt}>
                {formatCreatedAt(item.createdAt)}
              </span>
            </div>
          </div>

          <p className={styles.description}>
            {item.body || "No description provided."}
          </p>

          <dl className={styles.metaList}>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Status</dt>
              <dd className={styles.metaValue}>
                {isAuthor ? (
                  <select
                    className={styles.statusSelect}
                    data-status={item.status}
                    data-agent-action="change-feedback-status"
                    data-agent-proof="feedback-details-status-editable"
                    aria-label="Change feedback status"
                    value={item.status}
                    onChange={(event) =>
                      setStatus(item.id, event.target.value as FeedbackStatus)
                    }
                  >
                    {statusOptions.map((value) => (
                      <option key={value} value={value}>
                        {statusLabel(value)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className={styles.statusTag}
                    data-status={item.status}
                    data-agent-proof="feedback-details-status-visible"
                  >
                    {statusLabel(item.status)}
                  </span>
                )}
              </dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Category</dt>
              <dd className={styles.metaValue}>{categoryLabel(item.category)}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Product</dt>
              <dd className={styles.metaValue}>{productLabel(item.product)}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Score</dt>
              <dd
                className={styles.metaValue}
                data-agent-proof="feedback-details-score-visible"
              >
                {item.voteScore} ({item.upvotes} up &middot; {item.downvotes} down)
              </dd>
            </div>
          </dl>

          <section
            className={styles.commentsSection}
            aria-label="Comments"
            data-agent-list="feedback-comments"
            data-agent-context-anchor="feedback-details-comments"
          >
            <h3 className={styles.commentsHeading}>
              Comments
              <span className={styles.commentsCount}>{item.commentCount}</span>
            </h3>
            {sortedComments.length === 0 ? (
              <p className={styles.commentsEmpty}>No comments yet</p>
            ) : (
              <ul className={styles.commentList}>
                {sortedComments.map((comment) => (
                  <li key={comment.id} className={styles.commentItem}>
                    <Avatar
                      avatarUrl={comment.author.avatarUrl}
                      name={comment.author.name}
                      type={comment.author.type}
                      size={28}
                      className={styles.commentAvatar}
                    />
                    <div className={styles.commentContent}>
                      <div className={styles.commentHeader}>
                        <span className={styles.commentAuthor}>
                          {comment.author.name}
                        </span>
                        <span className={styles.commentTime}>
                          {timeAgo(comment.createdAt)}
                        </span>
                      </div>
                      <span className={styles.commentText}>{comment.text}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
