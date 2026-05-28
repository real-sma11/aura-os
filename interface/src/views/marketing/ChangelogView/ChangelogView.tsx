import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  type ChangelogEntry,
  type ChangelogTimelineMedia,
  fetchChangelogEntries,
} from "../../../api/marketing/changelog";
import {
  AURA_PUBLIC_REPOS,
  fetchAuraCommitStats,
} from "../../../api/marketing/github-commits";
import { useCountUp } from "../../../hooks/use-count-up";
import { useRelativeTime } from "../../../hooks/use-relative-time";
import { BannerCard } from "../BannerCard/BannerCard";
import "./ChangelogView.css";

/**
 * Cap on how high the loading ramp climbs while we wait for the live
 * commits fetch to resolve. The animation visibly counts up to this
 * sentinel and then rapidly snaps to whatever the real total is once
 * `fetchAuraCommitStats` returns.
 */
const COMMITS_LOADING_TARGET = 1000;
const COMMITS_LOADING_RAMP_MS = 2500;
const COMMITS_LIVE_TITLE = `Live total across ${AURA_PUBLIC_REPOS.length} AURA repositories`;

const CHANGELOG_TIME_ZONE = "America/Los_Angeles";

const PST_MONTH_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHANGELOG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});

/**
 * "Current month" key in `YYYY-MM` form, anchored to America/Los_Angeles
 * so it lines up with the PST calendar dates the API helper bakes into
 * `entry.date` (see `toPstCalendarDate` in `api/marketing/changelog.ts`).
 * `en-CA` is used because it emits the ISO-like `YYYY-MM` literal we want
 * out of the box.
 */
function getCurrentPstMonthKey(now: Date = new Date()): string {
  return PST_MONTH_FORMATTER.format(now);
}

interface ChangelogStats {
  readonly releasesThisMonth: number;
  readonly releasesAllTime: number;
}

interface ReleasesPerDayPoint {
  readonly date: string;
  readonly releases: number;
}

function entryReleases(entry: ChangelogEntry): number {
  return entry.rendered.entries.length;
}

function computeStats(
  entries: readonly ChangelogEntry[],
  monthKey: string,
): ChangelogStats {
  const thisMonth = entries.filter((entry) => entry.date.startsWith(monthKey));
  return {
    releasesThisMonth: thisMonth.reduce((n, e) => n + entryReleases(e), 0),
    releasesAllTime: entries.reduce((n, e) => n + entryReleases(e), 0),
  };
}

function computeReleasesPerDay(
  entries: readonly ChangelogEntry[],
): readonly ReleasesPerDayPoint[] {
  return [...entries]
    .map((entry) => ({ date: entry.date, releases: entryReleases(entry) }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

const STAT_NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

function formatStatLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

interface ReleasesPerDayChartProps {
  readonly series: readonly ReleasesPerDayPoint[];
}

/**
 * Tiny inline-SVG bar chart of releases-per-day, chronological ascending.
 * Avoids pulling in a charting dependency for what's essentially ~15 bars
 * of context next to the stat grid. Bars normalize against the dataset's
 * max release count; the most recent day gets a brighter accent fill so
 * it reads as "today".
 */
function ReleasesPerDayChart({
  series,
}: ReleasesPerDayChartProps): ReactNode {
  // `useId` / `useState` run before the early return so hook order stays
  // stable across renders regardless of whether the dataset is empty on
  // first paint.
  const reactId = useId();
  const gradientId = `${reactId}-bar-fill`;
  const glowId = `${reactId}-bar-glow`;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (series.length === 0) {
    return null;
  }

  const viewWidth = 260;
  const viewHeight = 96;
  const gap = 2;
  const barWidth = Math.max((viewWidth - gap * (series.length - 1)) / series.length, 1);
  const max = series.reduce((acc, point) => Math.max(acc, point.releases), 0);
  const lastIndex = series.length - 1;

  const hoveredPoint =
    hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < series.length
      ? series[hoveredIndex]
      : null;

  // When a bar is hovered the caption swaps to show that bar's release
  // count + date so the user gets immediate textual feedback without the
  // ~500ms delay the native SVG `<title>` tooltip imposes. The bar itself
  // still brightens via `:hover` so the visual "which one" + textual
  // "how many" channels reinforce each other.
  const caption = hoveredPoint
    ? `${hoveredPoint.releases} release${hoveredPoint.releases === 1 ? "" : "s"} · ${formatStatLabel(hoveredPoint.date)}`
    : "Releases per day";

  return (
    <div
      className="changelogStatsChartWrap"
      data-hovered={hoveredPoint !== null ? "true" : "false"}
      onPointerLeave={() => setHoveredIndex(null)}
    >
      <span
        className="changelogStatsChartCaption"
        role="status"
        aria-live="polite"
      >
        {caption}
      </span>
    <svg
      className="changelogStatsChart"
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Releases per day over time"
    >
      <defs>
        {/*
         * Gradient is anchored to the CHART (userSpaceOnUse with y1 at the
         * baseline and y2 at the top) instead of each rect's bounding box.
         * That makes magnitude drive color naturally: short bars only sit
         * in the deep-purple basement while tall bars rise into the bright
         * pink crest. One definition, no per-bar color math.
         */}
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={viewHeight}
          x2={0}
          y2={0}
        >
          <stop offset="0%" stopColor="#3b0a5a" />
          <stop offset="30%" stopColor="#6b1ea1" />
          <stop offset="65%" stopColor="#c43c9a" />
          <stop offset="100%" stopColor="#ff64c8" />
        </linearGradient>
        {/*
         * Soft pink halo applied only to the latest bar so "today" still
         * pops without resorting to a brighter fill that would break the
         * gradient palette.
         */}
        <filter
          id={glowId}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {series.map((point, index) => {
        const ratio = max > 0 ? point.releases / max : 0;
        const barHeight = Math.max(ratio * viewHeight, point.releases > 0 ? 2 : 0);
        const x = index * (barWidth + gap);
        const y = viewHeight - barHeight;
        const isLatest = index === lastIndex;
        return (
          <rect
            key={`${point.date}-${index}`}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx={1}
            fill={`url(#${gradientId})`}
            filter={isLatest ? `url(#${glowId})` : undefined}
            className={
              isLatest
                ? "changelogStatsChartBar changelogStatsChartBarLatest"
                : "changelogStatsChartBar"
            }
            onPointerEnter={() => setHoveredIndex(index)}
          >
            <title>
              {`${formatStatLabel(point.date)}: ${point.releases} release${
                point.releases === 1 ? "" : "s"
              }`}
            </title>
          </rect>
        );
      })}
    </svg>
    </div>
  );
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatTimelineTime(value: string, fallbackLabel: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackLabel;
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: CHANGELOG_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "shortGeneric",
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: CHANGELOG_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(parsed);
  }
}

function getCommitUrl(repo: string, sha: string): string {
  return `https://github.com/cypher-asi/${repo}/commit/${sha}`;
}

function getMediaAltText(title: string, alt: string | undefined): string {
  return alt?.trim() || `${title} screenshot`;
}

/**
 * Marketing `/changelog` page. Ported from
 * `aura-web/src/app/changelog/page.tsx` as a client component that uses
 * React Query against the new `api/marketing/changelog` helper instead
 * of the Next.js `async` server component. Page chrome (public-mode
 * `AuraShell` + `PublicMarketingPanel` scroll column) is owned by the
 * parent route.
 */
export function ChangelogView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Changelog";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketing-changelog"],
    queryFn: fetchChangelogEntries,
  });

  // Live commit totals across the 7 public AURA repos. Kept separate
  // from the curated changelog query because the underlying GitHub REST
  // calls are independent and shouldn't block the page on cold load.
  const { data: liveCommitStats } = useQuery({
    queryKey: ["marketing-changelog-live-commits"],
    queryFn: ({ signal }) => fetchAuraCommitStats(undefined, signal),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Stabilize the empty fallback so memo deps below don't change every
  // render (React Query keeps `data` referentially stable across renders
  // until it refetches, but `?? []` would allocate a new array each time).
  const entries = useMemo<readonly ChangelogEntry[]>(() => data ?? [], [data]);
  const latestVersion = entries.find((entry) => entry.version)?.version;
  // Entries are sorted by date descending in `fetchChangelogEntries`, so
  // `entries[0]` is always the most recent release. Drive the relative
  // time off `generatedAt` because it's the wall-clock timestamp of when
  // the release was actually published, whereas `entry.date` is just
  // the PST calendar bucket.
  const latestRelease = entries[0];
  const latestReleaseAgo = useRelativeTime(latestRelease?.generatedAt);
  const renderEmpty = !isLoading && !isError && entries.length === 0;

  const stats = useMemo(
    () => computeStats(entries, getCurrentPstMonthKey()),
    [entries],
  );
  const releasesPerDay = useMemo(
    () => computeReleasesPerDay(entries),
    [entries],
  );

  // Drive the two commit stats through a count-up animation: ramp from
  // 0 toward COMMITS_LOADING_TARGET while the GitHub API is in flight,
  // then snap rapidly to the real total once it resolves.
  const commitsThisMonthDisplay = useCountUp({
    target: liveCommitStats ? liveCommitStats.commitsThisMonth : null,
    loadingTarget: COMMITS_LOADING_TARGET,
    loadingRampMs: COMMITS_LOADING_RAMP_MS,
  });
  const commitsAllTimeDisplay = useCountUp({
    target: liveCommitStats ? liveCommitStats.commitsAllTime : null,
    loadingTarget: COMMITS_LOADING_TARGET,
    loadingRampMs: COMMITS_LOADING_RAMP_MS,
  });

  return (
    <section className="changelogPage">
      <div className="changelogPageShell">
        <BannerCard
          ariaLabel="Changelog summary"
          className="changelogStatsCard"
        >
          <header className="changelogStatsCardHeader">
            <h1 className="changelogPageTitle">Changelog</h1>
            {(latestVersion || latestRelease) ? (
              <div className="changelogStatsCardMeta">
                {latestVersion ? (
                  <span className="changelogPageVersion">
                    Current version {latestVersion}
                  </span>
                ) : null}
                {latestRelease ? (
                  <span
                    className="changelogLatestRelease"
                    aria-label={`Most recent release was ${
                      latestReleaseAgo || "recently"
                    }`}
                  >
                    <time
                      className="changelogLatestReleaseTime"
                      dateTime={latestRelease.generatedAt}
                      title={new Date(
                        latestRelease.generatedAt,
                      ).toLocaleString()}
                    >
                      {latestReleaseAgo
                        ? `Released ${latestReleaseAgo}`
                        : "Released recently"}
                    </time>
                    <span
                      className="changelogLatestReleaseSeparator"
                      aria-hidden="true"
                    >
                      {" · "}
                    </span>
                    <Link
                      to="/download"
                      className="changelogLatestReleaseDownload"
                    >
                      Download
                      <span aria-hidden="true">&nbsp;&rarr;</span>
                    </Link>
                  </span>
                ) : null}
              </div>
            ) : null}
          </header>

          <div className="changelogStatsCardBody">
            <dl className="changelogStatsGrid">
              <div className="changelogStat">
                <dt className="changelogStatLabel">Releases this month</dt>
                <dd className="changelogStatValue">
                  {STAT_NUMBER_FORMATTER.format(stats.releasesThisMonth)}
                </dd>
              </div>
              <div className="changelogStat">
                <dt className="changelogStatLabel">Commits this month</dt>
                <dd
                  className="changelogStatValue"
                  aria-live="polite"
                  aria-busy={liveCommitStats ? "false" : "true"}
                  title={COMMITS_LIVE_TITLE}
                >
                  {STAT_NUMBER_FORMATTER.format(commitsThisMonthDisplay)}
                </dd>
              </div>
              <div className="changelogStat">
                <dt className="changelogStatLabel">All-time releases</dt>
                <dd className="changelogStatValue">
                  {STAT_NUMBER_FORMATTER.format(stats.releasesAllTime)}
                </dd>
              </div>
              <div className="changelogStat">
                <dt className="changelogStatLabel">All-time commits</dt>
                <dd
                  className="changelogStatValue"
                  aria-live="polite"
                  aria-busy={liveCommitStats ? "false" : "true"}
                  title={COMMITS_LIVE_TITLE}
                >
                  {STAT_NUMBER_FORMATTER.format(commitsAllTimeDisplay)}
                </dd>
              </div>
            </dl>

            <ReleasesPerDayChart series={releasesPerDay} />
          </div>
        </BannerCard>

        {entries.length > 0 ? (
          <div className="changelogEntries" aria-label="Aura changelog entries">
            {entries.map((entry) => {
              const entryKey = `${entry.date}-${entry.version ?? entry.generatedAt}`;
              const releaseCount = entry.rendered.entries.length;
              const commitCount =
                entry.filteredCommitCount ?? entry.rawCommitCount;
              const highlights = Array.from(new Set(entry.rendered.highlights));

              return (
                <article key={entryKey} className="changelogEntry">
                  <time
                    className="changelogEntryDate"
                    dateTime={entry.date}
                  >
                    {formatDateLabel(entry.date)}
                  </time>

                  <div className="changelogEntryBody">
                    <div className="changelogEntryHead">
                      <div className="changelogEntryMeta">
                        <span>{entry.channel}</span>
                        <span>
                          {releaseCount} release{releaseCount === 1 ? "" : "s"}
                        </span>
                        <span>{commitCount} commits</span>
                      </div>

                      {highlights.length > 0 && (
                        <section
                          className="changelogTldr"
                          aria-label="Daily Update"
                        >
                          <h2 className="changelogTldrLabel">Daily Update</h2>
                          <ol className="changelogTldrList">
                            {highlights.map((highlight, highlightIndex) => (
                              <li
                                key={highlight}
                                className="changelogTldrItem"
                              >
                                <span className="changelogTldrItemNumber">
                                  {highlightIndex + 1}.
                                </span>
                                <span>{highlight}</span>
                              </li>
                            ))}
                          </ol>
                        </section>
                      )}
                    </div>

                    <div className="changelogEntryTimeline">
                      {entry.rendered.entries.map(
                        (timelineEntry, timelineIndex) => {
                          const media: ChangelogTimelineMedia | undefined =
                            timelineEntry.media?.status === "published" &&
                            timelineEntry.media.assetUrl
                              ? timelineEntry.media
                              : undefined;

                          return (
                            <section
                              key={`${entryKey}-${timelineIndex}-${timelineEntry.started_at}`}
                              className="changelogTimelineItem"
                            >
                              <span className="changelogSectionTime">
                                {formatTimelineTime(
                                  timelineEntry.started_at,
                                  timelineEntry.time_label,
                                )}
                              </span>
                              <div className="changelogSection">
                                <h3 className="changelogSectionTitle">
                                  {timelineEntry.title}
                                </h3>
                                <p className="changelogSectionSummary">
                                  {timelineEntry.summary}
                                </p>
                                {media && (
                                  <figure className="changelogSectionMedia">
                                    <a
                                      href={media.assetUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="changelogSectionMediaLink"
                                      aria-label={`Open screenshot for ${timelineEntry.title}`}
                                    >
                                      <img
                                        src={media.assetUrl}
                                        alt={getMediaAltText(
                                          timelineEntry.title,
                                          media.alt,
                                        )}
                                        className="changelogSectionMediaImage"
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    </a>
                                  </figure>
                                )}
                                {timelineEntry.items.length > 0 && (
                                  <ul className="changelogSectionList">
                                    {timelineEntry.items.map(
                                      (item, itemIndex) => (
                                        <li
                                          key={`${timelineEntry.title}-${itemIndex}`}
                                          className="changelogSectionItem"
                                        >
                                          <p>{item.text}</p>
                                          {item.commit_shas.length > 0 && (
                                            <div className="changelogSectionSources">
                                              <span className="changelogSectionSourcesLabel">
                                                Sources
                                              </span>
                                              {item.commit_shas.map((sha) => (
                                                <a
                                                  key={sha}
                                                  href={getCommitUrl(
                                                    entry.repo,
                                                    sha,
                                                  )}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="changelogSectionCommitLink"
                                                >
                                                  {sha.slice(0, 7)}
                                                </a>
                                              ))}
                                            </div>
                                          )}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                )}
                              </div>
                            </section>
                          );
                        },
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : renderEmpty ? (
          <div className="changelogEmptyState">
            <h2>No changelog entries yet.</h2>
            <p>
              The release feed is connected, but no published changelog
              entries were found yet.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}