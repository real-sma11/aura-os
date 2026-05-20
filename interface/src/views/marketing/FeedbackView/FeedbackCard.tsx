import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import type { FeedbackEntry } from "../../../api/marketing/feedback";
import { CATEGORY_LABELS, STATUS_LABELS } from "./feedback-constants";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export interface FeedbackCardProps {
  readonly entry: FeedbackEntry;
}

export function FeedbackCard({ entry }: FeedbackCardProps): ReactNode {
  const authorName = entry.authorName ?? "Anonymous";
  const category = CATEGORY_LABELS[entry.category] ?? entry.category;
  const status = STATUS_LABELS[entry.status] ?? entry.status;

  return (
    <article className="feedbackCard">
      <div className="feedbackCardVotes" aria-label="Vote score">
        <span className="feedbackCardVoteIcon" aria-hidden>
          <ChevronUp size={16} strokeWidth={1.75} />
        </span>
        <span className="feedbackCardVoteScore">{entry.voteScore}</span>
        <span className="feedbackCardVoteIcon" aria-hidden>
          <ChevronDown size={16} strokeWidth={1.75} />
        </span>
      </div>

      <div className="feedbackCardBody">
        <div className="feedbackCardHeader">
          <span className="feedbackCardAuthor">{authorName}</span>
          <span className="feedbackCardDot" aria-hidden>
            &middot;
          </span>
          <span className="feedbackCardTime">{timeAgo(entry.createdAt)}</span>
          <span className="feedbackCardCategoryGroup">
            <span className="feedbackCardDot" aria-hidden>
              &middot;
            </span>
            <span className="feedbackCardCategory">{category}</span>
          </span>
          <span className="feedbackCardHeaderSpacer" />
          <span className="feedbackCardStatus" data-status={entry.status}>
            {status}
          </span>
        </div>

        <h3 className="feedbackCardTitle">{entry.title}</h3>
        {entry.body ? (
          <p className="feedbackCardPreview">{entry.body}</p>
        ) : null}

        {entry.commentCount > 0 ? (
          <div className="feedbackCardMeta">
            <MessageSquare size={12} strokeWidth={1.75} />
            {entry.commentCount} comment{entry.commentCount === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>
    </article>
  );
}