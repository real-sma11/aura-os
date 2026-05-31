/**
 * Pure helpers for computing how many releases a desktop build is behind
 * the latest on its channel. The native updater only ever reports the
 * single latest version, so the actual "releases behind" count is derived
 * from the GitHub Releases list (see `useReleasesBehind`). These helpers
 * are split out so they can be unit-tested without a network/React harness.
 */

export type ReleaseChannel = "stable" | "nightly";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Full prerelease string (e.g. `nightly.562.1`) or `null` for stable. */
  prerelease: string | null;
  /** Monotonic nightly run number parsed from `nightly.<N>`, if present. */
  nightlyRun: number | null;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(.+?))?(?:\+.+)?$/;

/** Strip a leading `v`/`V` and surrounding whitespace from a tag/version. */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

export function parseVersion(raw: string | null | undefined): ParsedVersion | null {
  if (!raw) return null;
  const match = SEMVER_RE.exec(normalizeVersion(raw));
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  const pre = prerelease ?? null;
  let nightlyRun: number | null = null;
  if (pre) {
    const nm = /nightly\.(\d+)/i.exec(pre);
    if (nm) nightlyRun = Number(nm[1]);
  }
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: pre,
    nightlyRun,
  };
}

export function channelOf(version: string): ReleaseChannel {
  return /-nightly/i.test(version) ? "nightly" : "stable";
}

/**
 * Semver-ish comparison. Returns -1 / 0 / 1. Unparseable inputs compare
 * equal (0) so they are never counted as "newer". A version with a
 * prerelease tag is ordered *below* the same core release (standard
 * semver precedence); two nightlies compare by run number.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  if (pa.nightlyRun !== null && pb.nightlyRun !== null) {
    if (pa.nightlyRun !== pb.nightlyRun) return pa.nightlyRun < pb.nightlyRun ? -1 : 1;
    return 0;
  }
  if (pa.prerelease < pb.prerelease) return -1;
  if (pa.prerelease > pb.prerelease) return 1;
  return 0;
}

export interface ReleaseTag {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
}

/**
 * Count published releases on the active channel that are strictly newer
 * than `currentVersion`. Drafts are ignored; channel membership is decided
 * by the tag shape (`-nightly` => nightly, otherwise stable).
 */
export function countReleasesBehind(
  releases: ReleaseTag[],
  currentVersion: string,
  channel: ReleaseChannel,
): number {
  return releases.filter((release) => {
    if (release.draft) return false;
    const tag = release.tag_name ? normalizeVersion(release.tag_name) : "";
    if (!parseVersion(tag)) return false;
    if (channelOf(tag) !== channel) return false;
    return compareVersions(tag, currentVersion) > 0;
  }).length;
}

/**
 * Best-effort distance when the GitHub Releases list cannot be loaded.
 * Only returns a number when we can count releases with confidence:
 *   - both versions are nightlies => difference of run numbers
 *   - same major+minor => difference of patch numbers
 * Anything else (cross-minor / cross-major stable gaps) returns `null`
 * so the caller does not hard-block on a guess.
 */
export function fallbackReleasesBehind(
  currentVersion: string,
  latestVersion: string,
): number | null {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) return null;
  if (compareVersions(latestVersion, currentVersion) <= 0) return 0;
  if (current.nightlyRun !== null && latest.nightlyRun !== null) {
    return Math.max(0, latest.nightlyRun - current.nightlyRun);
  }
  if (current.major === latest.major && current.minor === latest.minor) {
    return Math.max(0, latest.patch - current.patch);
  }
  return null;
}

/**
 * Derive `{ owner, repo }` from the updater base URL, which the desktop
 * backend reports as `https://<owner>.github.io/<repo>` (GitHub Pages).
 * Returns `null` for any non-Pages URL so the caller falls back cleanly.
 */
export function parseGithubRepo(
  updateBaseUrl: string | null | undefined,
): { owner: string; repo: string } | null {
  if (!updateBaseUrl) return null;
  try {
    const url = new URL(updateBaseUrl);
    const ghMatch = /^([^.]+)\.github\.io$/i.exec(url.hostname);
    if (!ghMatch) return null;
    const owner = ghMatch[1];
    const repo = url.pathname.split("/").filter(Boolean)[0];
    if (!repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}
