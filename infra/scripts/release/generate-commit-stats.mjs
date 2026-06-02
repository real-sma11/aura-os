#!/usr/bin/env node

/**
 * Deploy-time commit/release-count snapshot for the marketing
 * `/changelog` page.
 *
 * Runs both inside the release/changelog CI job (see
 * `.github/workflows/publish-release-changelog.yml`) and on every push to
 * main (see `.github/workflows/refresh-commit-stats.yml`) so the figures
 * stay current between releases — otherwise a new month starts stuck at 0
 * until the first release republishes the snapshot. The workflow's
 * built-in `GITHUB_TOKEN` provides an authenticated GitHub REST budget
 * (1000 req/hr/repo) — so the per-repo commit fan-out plus the aura-os
 * release pagination never trips the 60 req/hr/IP unauthenticated limit
 * that throttled the old in-browser / Render-server approach on shared
 * egress IPs.
 *
 * It writes `<pages-dir>/commit-stats.json` onto the `gh-pages` branch,
 * which the SPA reads statically (same host as the changelog index). A
 * committed file is inherently durable, so the contract is:
 *
 *   - Refresh on each release run ("update each deploy").
 *   - A repo whose fetch fails this run keeps its previously committed
 *     counts instead of regressing to 0 (per-repo last-good merge).
 *   - If NO fetch succeeded this run, write nothing at all so the prior
 *     committed snapshot stays put ("stays the same, updates again when
 *     it makes sense").
 *
 * The per-repo count uses GitHub's `per_page=1` + `Link: rel="last"`
 * trick so each (repo, range) costs a single request.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_OWNER = "cypher-asi";
const PST_TIME_ZONE = "America/Los_Angeles";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Public AURA repositories whose commits roll up into the changelog
 * totals. Kept in sync with `AURA_PUBLIC_REPOS` in
 * `interface/src/api/marketing/github-commits.ts` and the (now retired)
 * server handler.
 */
export const AURA_PUBLIC_REPOS = [
  "aura-os",
  "aura-harness",
  "aura-router",
  "aura-network",
  "aura-storage",
  "aura-swarm",
  "aura-website",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Parse the GitHub `Link` header (RFC 5988) and return the `page=N`
 * value of the `rel="last"` link, or `null` when no such link exists.
 * With `per_page=1` that page number equals the total commit count for
 * the requested range.
 */
export function parseLastPageFromLink(header) {
  if (!header) return null;
  for (const segment of header.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed.includes('rel="last"')) continue;
    const start = trimmed.indexOf("<");
    const end = trimmed.indexOf(">", start + 1);
    if (start === -1 || end === -1) continue;
    const urlStr = trimmed.slice(start + 1, end);
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      continue;
    }
    const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
    if (Number.isFinite(page) && page > 0) return page;
  }
  return null;
}

/**
 * Resolve the ISO instant marking the start of the current calendar
 * month in `America/Los_Angeles`, plus the `YYYY-MM` PST month key. The
 * SPA gates its "commits this month" display on the same key so a month
 * rollover never shows last month's count as "this month".
 */
export function pstMonthAnchor(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const lookup = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  const second = Number(lookup.second);

  // The PST wall-clock offset varies with DST. Recover it by diffing the
  // wall clock against the UTC clock of the same instant, then apply it
  // to the month-start wall clock to land on the right UTC instant.
  const asUtcEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = asUtcEpoch - now.getTime();
  const monthStartUtc = Date.UTC(year, month - 1, 1, 0, 0, 0);

  return {
    sinceIso: new Date(monthStartUtc - offsetMs).toISOString(),
    monthKey: `${lookup.year}-${lookup.month}`,
  };
}

/**
 * Count commits for one (repo, range). Returns `null` on any failure
 * (network, non-2xx, malformed body) so the caller can fall back to the
 * previously committed value for that repo.
 */
export async function countCommits({ owner, repo, since, token, fetchImpl = fetch }) {
  const url = new URL(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits`);
  url.searchParams.set("per_page", "1");
  if (since) url.searchParams.set("since", since);

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aura-os-commit-stats",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`commit-stats: ${repo} request failed: ${err?.message ?? err}`);
    return null;
  }

  if (!response.ok) {
    console.warn(`commit-stats: ${repo} returned HTTP ${response.status}`);
    return null;
  }

  const lastPage = parseLastPageFromLink(response.headers.get("link"));
  if (lastPage != null) return lastPage;

  // No Link header => fewer than per_page commits in range; read the
  // body to distinguish 0 from 1.
  try {
    const body = await response.json();
    return Array.isArray(body) ? body.length : 0;
  } catch (err) {
    console.warn(`commit-stats: ${repo} malformed body: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Count GitHub releases for one repo. Returns `{ allTime, thisMonth }`
 * where `thisMonth` is the number of (non-draft) releases published on
 * or after `since`, or `null` on any failure so the caller can fall
 * back to the previously committed values. Drafts are excluded; nightly
 * prereleases are counted. Pages through `per_page=100` until a short
 * page signals the end of the list.
 */
export async function countReleases({
  owner,
  repo,
  since,
  token,
  fetchImpl = fetch,
}) {
  const sinceMs = since ? new Date(since).getTime() : null;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aura-os-commit-stats",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let allTime = 0;
  let thisMonth = 0;

  for (let page = 1; page <= 50; page += 1) {
    const url = new URL(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    let response;
    try {
      response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      console.warn(
        `commit-stats: ${repo} releases request failed: ${err?.message ?? err}`,
      );
      return null;
    }

    if (!response.ok) {
      console.warn(
        `commit-stats: ${repo} releases returned HTTP ${response.status}`,
      );
      return null;
    }

    let body;
    try {
      body = await response.json();
    } catch (err) {
      console.warn(
        `commit-stats: ${repo} releases malformed body: ${err?.message ?? err}`,
      );
      return null;
    }

    if (!Array.isArray(body)) return null;

    for (const release of body) {
      if (!release || typeof release !== "object") continue;
      if (release.draft === true) continue;
      allTime += 1;
      const stamp = release.published_at ?? release.created_at;
      if (sinceMs != null && stamp) {
        const stampMs = new Date(stamp).getTime();
        if (Number.isFinite(stampMs) && stampMs >= sinceMs) thisMonth += 1;
      }
    }

    if (body.length < 100) break;
  }

  return { allTime, thisMonth };
}

/**
 * Resolve this run's release counts against the prior snapshot, mirroring
 * the per-repo commit fallback: a failed all-time keeps the prior
 * all-time; a failed this-month keeps the prior this-month only when the
 * prior snapshot belongs to the same PST month (otherwise it resets to 0
 * rather than carrying last month's number forward).
 */
export function mergeReleaseCounts({ fetched, prior, monthKey }) {
  const priorSameMonth = Boolean(prior && prior.monthKey === monthKey);
  const { allTime, thisMonth } = fetched ?? { allTime: null, thisMonth: null };

  const releasesAllTime =
    allTime == null ? prior?.releasesAllTime ?? 0 : allTime;
  const releasesThisMonth =
    thisMonth == null
      ? priorSameMonth
        ? prior?.releasesThisMonth ?? 0
        : 0
      : thisMonth;

  return { releasesThisMonth, releasesAllTime };
}

/**
 * Merge this run's freshly-fetched per-repo counts with the prior
 * committed snapshot. A failed all-time keeps the prior all-time; a
 * failed this-month keeps the prior this-month only when the prior
 * snapshot belongs to the same PST month (otherwise it'd carry last
 * month's number forward, so it resets to 0 instead).
 */
export function mergeSnapshot({ repos, fetched, prior, monthKey, fetchedAt }) {
  const priorSameMonth = Boolean(prior && prior.monthKey === monthKey);
  const perRepo = {};
  let commitsThisMonth = 0;
  let commitsAllTime = 0;
  let partial = false;
  let anySuccess = false;

  for (const repo of repos) {
    const { allTime, thisMonth } = fetched[repo] ?? { allTime: null, thisMonth: null };
    const priorRepo = prior?.perRepo?.[repo];

    if (allTime !== null || thisMonth !== null) anySuccess = true;
    if (allTime === null || thisMonth === null) partial = true;

    const resolvedAllTime = allTime === null ? priorRepo?.allTime ?? 0 : allTime;
    const resolvedThisMonth =
      thisMonth === null
        ? priorSameMonth
          ? priorRepo?.thisMonth ?? 0
          : 0
        : thisMonth;

    perRepo[repo] = { thisMonth: resolvedThisMonth, allTime: resolvedAllTime };
    commitsThisMonth += resolvedThisMonth;
    commitsAllTime += resolvedAllTime;
  }

  return {
    anySuccess,
    snapshot: {
      commitsThisMonth,
      commitsAllTime,
      perRepo,
      monthKey,
      fetchedAt,
      partial,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pagesDir = path.resolve(args["pages-dir"] || ".");
  const outFile = args.out
    ? path.resolve(args.out)
    : path.join(pagesDir, "commit-stats.json");
  const owner = String(args.owner || DEFAULT_OWNER);
  const token =
    process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";

  if (!token) {
    console.warn(
      "commit-stats: no GITHUB_TOKEN/GH_TOKEN set; falling back to unauthenticated requests (60 req/hr/IP).",
    );
  }

  const { sinceIso, monthKey } = pstMonthAnchor();
  const prior = readJsonIfExists(outFile);

  const fetched = {};
  let releaseFetched = null;
  await Promise.all([
    ...AURA_PUBLIC_REPOS.map(async (repo) => {
      const allTime = await countCommits({ owner, repo, token });
      const thisMonth = await countCommits({ owner, repo, since: sinceIso, token });
      fetched[repo] = { allTime, thisMonth };
    }),
    (async () => {
      // Releases are tracked for the primary `aura-os` repo only.
      releaseFetched = await countReleases({
        owner,
        repo: "aura-os",
        since: sinceIso,
        token,
      });
    })(),
  ]);

  const { anySuccess, snapshot } = mergeSnapshot({
    repos: AURA_PUBLIC_REPOS,
    fetched,
    prior,
    monthKey,
    fetchedAt: new Date().toISOString(),
  });

  const releaseCounts = mergeReleaseCounts({
    fetched: releaseFetched,
    prior,
    monthKey,
  });
  const releaseSuccess = releaseFetched != null;

  if (!anySuccess && !releaseSuccess) {
    if (prior) {
      console.warn(
        "commit-stats: every repo and release fetch failed; keeping the existing committed snapshot.",
      );
    } else {
      console.warn(
        "commit-stats: every repo and release fetch failed and no prior snapshot exists; writing nothing.",
      );
    }
    return;
  }

  const finalSnapshot = { ...snapshot, ...releaseCounts };
  writeJson(outFile, finalSnapshot);
  console.log(
    `commit-stats: wrote ${outFile} (commitsThisMonth=${finalSnapshot.commitsThisMonth}, commitsAllTime=${finalSnapshot.commitsAllTime}, releasesThisMonth=${finalSnapshot.releasesThisMonth}, releasesAllTime=${finalSnapshot.releasesAllTime}, partial=${finalSnapshot.partial}, monthKey=${finalSnapshot.monthKey})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
