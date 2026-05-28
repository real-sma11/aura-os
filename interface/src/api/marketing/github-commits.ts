/**
 * Live commit-count aggregation for the marketing `/changelog` page.
 *
 * The curated changelog index published by
 * `infra/scripts/release/generate-daily-changelog.mjs` only covers the
 * `aura-os` repo. To populate the changelog summary card's
 * "commits this month" / "all-time commits" totals across the broader
 * AURA codebase, the SPA fetches live commit counts from the GitHub
 * REST API at render time, no auth required.
 *
 * Strategy: use the standard `per_page=1` + `Link: rel="last"` trick so
 * each (repo, range) costs exactly one request. With 7 public repos and
 * two ranges (all-time + this month in PST) we issue 14 unauthenticated
 * requests per cold load, well under GitHub's 60 req/hr/IP budget.
 *
 * Failures are absorbed per-repo and surfaced via `partial: true` so the
 * UI can still render whatever totals were resolved successfully.
 */

export const AURA_PUBLIC_REPOS = [
  "aura-os",
  "aura-harness",
  "aura-router",
  "aura-network",
  "aura-storage",
  "aura-swarm",
  "aura-website",
] as const;

export type AuraPublicRepo = (typeof AURA_PUBLIC_REPOS)[number];

export interface RepoCommitCounts {
  readonly thisMonth: number;
  readonly allTime: number;
}

export interface LiveCommitStats {
  readonly commitsThisMonth: number;
  readonly commitsAllTime: number;
  readonly perRepo: Readonly<Record<string, RepoCommitCounts>>;
  readonly fetchedAt: string;
  /**
   * True when at least one per-repo fetch failed. The totals still
   * reflect the successful ones; callers can choose whether to surface
   * the partial state to the user.
   */
  readonly partial: boolean;
}

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_OWNER = "cypher-asi";
const PST_TIME_ZONE = "America/Los_Angeles";

const PST_MONTH_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: PST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * Resolve the ISO timestamp that marks the start of the current
 * calendar month in `America/Los_Angeles`. Used as the `since=` query
 * param so "commits this month" matches the PST month anchor the rest
 * of the changelog UI already uses (see `getCurrentPstMonthKey` in
 * `ChangelogView.tsx`).
 */
export function pstMonthStartIso(now: Date = new Date()): string {
  const parts = PST_MONTH_PARTS_FORMATTER.formatToParts(now);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }

  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  const second = Number(lookup.second);

  // The PST wall-clock offset varies with DST. Reconstruct the offset
  // by diffing the wall clock against the UTC clock of the same instant
  // — `now.getTime() - asUtc` gives the local offset in ms, which we
  // then apply to the month-start wall clock to land on the right UTC
  // instant.
  const asUtcEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = asUtcEpoch - now.getTime();

  const monthStartUtc = Date.UTC(year, month - 1, 1, 0, 0, 0);
  return new Date(monthStartUtc - offsetMs).toISOString();
}

/**
 * Parse the GitHub `Link` header (RFC 5988) and return the `page=N`
 * value of the `rel="last"` link, or `null` when no such link exists.
 */
export function parseLastPageFromLink(linkHeader: string | null): number | null {
  if (!linkHeader) {
    return null;
  }
  for (const segment of linkHeader.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed.includes('rel="last"')) {
      continue;
    }
    const match = trimmed.match(/<([^>]+)>/);
    if (!match) {
      continue;
    }
    try {
      const url = new URL(match[1]);
      const page = url.searchParams.get("page");
      const parsed = page ? Number.parseInt(page, 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    } catch {
      // Malformed URL in Link header — fall through to next segment.
    }
  }
  return null;
}

async function countCommits(
  repo: string,
  sinceIso: string | undefined,
  signal: AbortSignal | undefined,
): Promise<number> {
  const params = new URLSearchParams({ per_page: "1" });
  if (sinceIso) {
    params.set("since", sinceIso);
  }
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${repo}/commits?${params.toString()}`;

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub commits request for ${repo} failed: ${response.status} ${response.statusText}`,
    );
  }

  const lastPage = parseLastPageFromLink(response.headers.get("Link"));
  if (lastPage !== null) {
    return lastPage;
  }

  // No Link header => fewer than `per_page` commits in this range.
  // Read the body to distinguish 0 from 1.
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? body.length : 0;
}

/**
 * Fetch live commit counts (this-month and all-time) for every repo in
 * `AURA_PUBLIC_REPOS` and return aggregated totals. Per-repo failures
 * are absorbed so a single 404 or rate-limit doesn't blank the entire
 * stats card; the `partial` flag indicates whether any contributor
 * dropped out.
 */
export async function fetchAuraCommitStats(
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<LiveCommitStats> {
  const sinceIso = pstMonthStartIso(now);

  const settled = await Promise.allSettled(
    AURA_PUBLIC_REPOS.flatMap((repo) => [
      countCommits(repo, undefined, signal).then((allTime) => ({
        repo,
        range: "allTime" as const,
        count: allTime,
      })),
      countCommits(repo, sinceIso, signal).then((thisMonth) => ({
        repo,
        range: "thisMonth" as const,
        count: thisMonth,
      })),
    ]),
  );

  const perRepo: Record<string, { thisMonth: number; allTime: number }> = {};
  for (const repo of AURA_PUBLIC_REPOS) {
    perRepo[repo] = { thisMonth: 0, allTime: 0 };
  }

  let partial = false;
  for (const result of settled) {
    if (result.status !== "fulfilled") {
      partial = true;
      continue;
    }
    const { repo, range, count } = result.value;
    perRepo[repo][range] = count;
  }

  let commitsThisMonth = 0;
  let commitsAllTime = 0;
  for (const repo of AURA_PUBLIC_REPOS) {
    commitsThisMonth += perRepo[repo].thisMonth;
    commitsAllTime += perRepo[repo].allTime;
  }

  return {
    commitsThisMonth,
    commitsAllTime,
    perRepo,
    fetchedAt: now.toISOString(),
    partial,
  };
}
