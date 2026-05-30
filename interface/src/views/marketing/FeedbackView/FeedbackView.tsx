import { type ReactNode, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  listFeedback,
  normalizeCategory,
  normalizeSort,
  normalizeStatus,
} from "../../../api/marketing/feedback";
import { useCountUp } from "../../../hooks/use-count-up";
import { BannerCard } from "../BannerCard/BannerCard";

import { FeedbackCard } from "./FeedbackCard";
import { FeedbackFilters } from "./FeedbackFilters";
import "./FeedbackView.css";

const STAT_NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

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

  // Summary metrics are computed from an unfiltered fetch so the banner
  // totals stay stable while the user changes the list filters. The
  // public endpoint caps results at 200 and exposes no aggregate-stats
  // route, so these are approximations over the most recent items.
  const { data: statsData } = useQuery({
    queryKey: ["marketing-feedback-stats"],
    queryFn: () => listFeedback({ limit: 200 }),
    staleTime: 5 * 60 * 1000,
  });

  const stats = useMemo(() => {
    const items = statsData ?? [];
    const resolved = items.filter(
      (item) => item.status === "done" || item.status === "deployed",
    ).length;
    const participants = new Set(
      items
        .map((item) => item.authorName)
        .filter((name): name is string => Boolean(name)),
    ).size;
    return { submitted: items.length, resolved, participants };
  }, [statsData]);

  const submittedDisplay = useCountUp({
    target: statsData ? stats.submitted : null,
  });
  const resolvedDisplay = useCountUp({
    target: statsData ? stats.resolved : null,
  });
  const participantsDisplay = useCountUp({
    target: statsData ? stats.participants : null,
  });

  const entries = data ?? [];
  const showEmpty = !isLoading && entries.length === 0;

  return (
    <section className="feedbackPage">
      <div className="feedbackBannerWrap">
        <BannerCard ariaLabel="Feedback summary" className="feedbackStatsCard">
          <header className="feedbackStatsCardHeader">
            <h1 className="feedbackPageTitle">Feedback</h1>
            <p className="feedbackPageSubtitle">
              Our users submit feedback and AURA autonomously improves itself.
            </p>
          </header>

          <dl className="feedbackStatsGrid">
            <div className="feedbackStat">
              <dt className="feedbackStatLabel">Items Submitted</dt>
              <dd className="feedbackStatValue">
                {STAT_NUMBER_FORMATTER.format(submittedDisplay)}
              </dd>
            </div>
            <div className="feedbackStat">
              <dt className="feedbackStatLabel">Items Resolved</dt>
              <dd className="feedbackStatValue">
                {STAT_NUMBER_FORMATTER.format(resolvedDisplay)}
              </dd>
            </div>
            <div className="feedbackStat">
              <dt className="feedbackStatLabel">Participants</dt>
              <dd className="feedbackStatValue">
                {STAT_NUMBER_FORMATTER.format(participantsDisplay)}
              </dd>
            </div>
          </dl>
        </BannerCard>
      </div>

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