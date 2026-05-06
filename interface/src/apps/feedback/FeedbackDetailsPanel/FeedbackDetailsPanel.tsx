import { useRef } from "react";
import { Info } from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import {
  useFeedback,
  useFeedbackItem,
} from "../../../stores/feedback-store";
import { timeAgo } from "../../../shared/utils/format";
import { categoryLabel, productLabel, statusLabel } from "../types";
import styles from "./FeedbackDetailsPanel.module.css";

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
  const { selectedId } = useFeedback();
  const item = useFeedbackItem(selectedId);
  const scrollRef = useRef<HTMLDivElement>(null);

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
                <span
                  className={styles.statusTag}
                  data-status={item.status}
                  data-agent-proof="feedback-details-status-visible"
                >
                  {statusLabel(item.status)}
                </span>
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
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>Comments</dt>
              <dd className={styles.metaValue}>{item.commentCount}</dd>
            </div>
          </dl>
        </div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
