/**
 * Commit-count totals for the marketing `/changelog` page.
 *
 * The card's "commits this month" / "all-time commits" numbers come from
 * a static `commit-stats.json` snapshot published to the `gh-pages`
 * branch by `infra/scripts/release/generate-commit-stats.mjs` during the
 * release/changelog CI run (same host as the changelog `index.json`).
 *
 * Why a published snapshot instead of a live fetch: the previous
 * approaches (browser fan-out, then a Render server proxy) both issued
 * unauthenticated GitHub requests from a shared egress IP and reliably
 * tripped GitHub's 60 req/hr/IP limit, so the card rendered `0`. The CI
 * job runs with the workflow's authenticated `GITHUB_TOKEN`, and a
 * committed file is durable: a throttled refresh simply keeps the prior
 * numbers and the next successful run updates them. The browser now just
 * reads one static, CORS-friendly JSON file.
 *
 * The `monthKey` (PST `YYYY-MM`) the snapshot was generated for travels
 * with it so the UI can avoid showing last month's count as "this month"
 * right after a month rollover (see `ChangelogView.tsx`).
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
  /**
   * GitHub release counts for `aura-os`. Optional for backward
   * compatibility with snapshots published before release tracking was
   * added; absent fields fall back to the changelog-index-derived counts
   * in the UI. `releasesThisMonth` is gated on `monthKey` like the commit
   * figure.
   */
  readonly releasesThisMonth?: number;
  readonly releasesAllTime?: number;
  readonly perRepo: Readonly<Record<string, RepoCommitCounts>>;
  /**
   * PST `YYYY-MM` the `commitsThisMonth` figure belongs to. The UI gates
   * its "commits this month" display on this matching the current PST
   * month so a stale snapshot never reports last month's count as the
   * current one.
   */
  readonly monthKey: string;
  readonly fetchedAt: string;
  /**
   * True when at least one per-repo count in the published snapshot fell
   * back to a previously-committed value (a fetch failed during that CI
   * run). Totals still reflect the best-known numbers.
   */
  readonly partial: boolean;
}

const DEFAULT_COMMIT_STATS_URL =
  "https://cypher-asi.github.io/aura-os/commit-stats.json";

function getCommitStatsUrl(): string {
  const raw = import.meta.env.VITE_COMMIT_STATS_URL;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return DEFAULT_COMMIT_STATS_URL;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normalize an untrusted parsed snapshot into `LiveCommitStats`, dropping
 * malformed per-repo entries. Returns `null` when the payload isn't a
 * usable object so callers can treat it like a failed fetch.
 */
function normalizeSnapshot(raw: unknown): LiveCommitStats | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  if (
    !isFiniteNumber(record.commitsThisMonth) ||
    !isFiniteNumber(record.commitsAllTime)
  ) {
    return null;
  }

  const perRepo: Record<string, RepoCommitCounts> = {};
  if (record.perRepo && typeof record.perRepo === "object") {
    for (const [repo, counts] of Object.entries(
      record.perRepo as Record<string, unknown>,
    )) {
      if (counts && typeof counts === "object") {
        const { thisMonth, allTime } = counts as Record<string, unknown>;
        if (isFiniteNumber(thisMonth) && isFiniteNumber(allTime)) {
          perRepo[repo] = { thisMonth, allTime };
        }
      }
    }
  }

  return {
    commitsThisMonth: record.commitsThisMonth,
    commitsAllTime: record.commitsAllTime,
    ...(isFiniteNumber(record.releasesThisMonth)
      ? { releasesThisMonth: record.releasesThisMonth }
      : {}),
    ...(isFiniteNumber(record.releasesAllTime)
      ? { releasesAllTime: record.releasesAllTime }
      : {}),
    perRepo,
    monthKey: typeof record.monthKey === "string" ? record.monthKey : "",
    fetchedAt:
      typeof record.fetchedAt === "string" ? record.fetchedAt : "",
    partial: record.partial === true,
  };
}

/**
 * Fetch the published commit-count snapshot from the `gh-pages` static
 * host. Throws on a non-2xx response or a malformed body so React Query
 * surfaces the failure and the changelog card falls back to its
 * last-known cached totals.
 */
export async function fetchAuraCommitStats(
  signal?: AbortSignal,
): Promise<LiveCommitStats> {
  const response = await fetch(getCommitStatsUrl(), {
    method: "GET",
    signal,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`commit-stats fetch failed: HTTP ${response.status}`);
  }

  const snapshot = normalizeSnapshot(await response.json());
  if (!snapshot) {
    throw new Error("commit-stats fetch returned a malformed snapshot");
  }
  return snapshot;
}
