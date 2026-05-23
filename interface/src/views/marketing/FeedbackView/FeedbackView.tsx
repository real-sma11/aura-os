import { type ReactNode, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  listFeedback,
  normalizeCategory,
  normalizeSort,
  normalizeStatus,
} from "../../../api/marketing/feedback";

import { FeedbackCard } from "./FeedbackCard";
import { FeedbackFilters } from "./FeedbackFilters";
import "./FeedbackView.css";

/**
 * Marketing `/feedback` page. Ported from
 * `aura-web/src/app/roadmap/page.tsx` (formerly "Roadmap") into the
 * logged-out marketing routes. Server-side `searchParams` becomes a
 * `useSearchParams()` call; the `await listFeedback(...)` call becomes a
 * React Query query so the page can re-fetch on filter changes without a
 * full reload.
 *
 * The fetch now goes to a same-origin pass-through on `aura-os-server`
 * (`GET /api/public/feedback`), which forwards to aura-network using the
 * server-side `AURA_NETWORK_URL`. The browser no longer reads any
 * upstream URL directly.
 */
export function FeedbackView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Feedback";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const [searchParams] = useSearchParams();
  const sort = normalizeSort(searchParams.get("sort"));
  const category = normalizeCategory(searchParams.get("type"));
  const status = normalizeStatus(searchParams.get("status"));

  const { data, isLoading } = useQuery({
    queryKey: ["marketing-feedback", sort, category, status],
    queryFn: () => listFeedback({ sort, category, status }),
  });

  const entries = data ?? [];
  const showEmpty = !isLoading && entries.length === 0;

  return (
    <section className="feedbackPage">
      <div className="feedbackPageShell">
        <FeedbackFilters sort={sort} category={category} status={status} />

        <div className="feedbackListColumn">
          {entries.length > 0 ? (
            <div className="feedbackList" aria-label="Feedback entries">
              {entries.map((entry) => (
                <FeedbackCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : showEmpty ? (
            <div className="feedbackEmptyState">
              <h2>No feedback yet.</h2>
              <p>No AURA feedback posts match the current filters.</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}