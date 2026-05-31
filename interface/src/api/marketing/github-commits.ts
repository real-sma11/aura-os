/**
 * Live commit-count aggregation for the marketing `/changelog` page.
 *
 * The curated changelog index published by
 * `infra/scripts/release/generate-daily-changelog.mjs` only covers the
 * `aura-os` repo. To populate the changelog summary card's
 * "commits this month" / "all-time commits" totals across the broader
 * AURA codebase, the SPA reads aggregate commit counts from the
 * same-origin `GET /api/public/commit-stats` endpoint.
 *
 * That endpoint used to live in the browser as a direct fan-out to the
 * GitHub REST API (`per_page=1` + `Link: rel="last"`), but 14
 * unauthenticated requests per cold load reliably exhausted GitHub's
 * 60 req/hr/IP budget (shared across every visitor behind a NAT plus
 * reloads), so the card rendered `0`. The fan-out now happens
 * server-side where it can attach an optional token (5000 req/hr) and
 * cache the aggregate; the browser issues a single same-origin request.
 *
 * The PST month boundary stays client-side (see `pstMonthStartIso`) and
 * is passed to the server as the `since` query param so "commits this
 * month" lines up with the PST month anchor the rest of the changelog
 * UI already uses.
 *
 * Failures are absorbed per-repo server-side and surfaced via
 * `partial: true` so the UI can still render whatever totals resolved.
 */

import { apiFetch } from "../../shared/api/core";

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

const COMMIT_STATS_PATH = "/api/public/commit-stats";
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
 * Fetch aggregate commit counts (this-month and all-time) across the
 * AURA public repos from the same-origin `GET /api/public/commit-stats`
 * proxy. The PST month boundary is computed client-side and passed as
 * `since` so "commits this month" matches the changelog UI's PST anchor.
 *
 * The server absorbs per-repo failures and caches the aggregate, so a
 * single 404 / rate-limit doesn't blank the entire stats card; the
 * `partial` flag indicates whether any repo dropped out of the totals.
 */
export async function fetchAuraCommitStats(
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<LiveCommitStats> {
  const sinceIso = pstMonthStartIso(now);
  const query = new URLSearchParams({ since: sinceIso });
  return apiFetch<LiveCommitStats>(`${COMMIT_STATS_PATH}?${query.toString()}`, {
    method: "GET",
    signal,
    timeoutMs: 15_000,
  });
}
