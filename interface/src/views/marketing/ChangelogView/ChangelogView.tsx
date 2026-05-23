import { type ReactNode, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type ChangelogTimelineMedia,
  fetchChangelogEntries,
} from "../../../api/marketing/changelog";
import "./ChangelogView.css";

const CHANGELOG_TIME_ZONE = "America/Los_Angeles";

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

  const entries = data ?? [];
  const latestVersion = entries.find((entry) => entry.version)?.version;
  const renderEmpty = !isLoading && !isError && entries.length === 0;

  return (
    <section className="changelogPage">
      <div className="changelogPageShell">
        <header className="changelogPageHeader">
          <h1 className="changelogPageTitle">Changelog</h1>
          {latestVersion ? (
            <span className="changelogPageVersion">
              Current version {latestVersion}
            </span>
          ) : null}
        </header>

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