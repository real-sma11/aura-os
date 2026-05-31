import { useQuery } from "@tanstack/react-query";
import {
  countReleasesBehind,
  fallbackReleasesBehind,
  parseGithubRepo,
  type ReleaseChannel,
  type ReleaseTag,
} from "./version-distance";

/**
 * Number of releases a user may be behind before the app forces an
 * upgrade. Once `releasesBehind >= FORCED_UPGRADE_THRESHOLD`, the
 * blocking overlay takes over the screen.
 */
export const FORCED_UPGRADE_THRESHOLD = 3;

interface UseReleasesBehindArgs {
  /** Only fetch/compute when an update is actually available. */
  enabled: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  channel: ReleaseChannel;
  updateBaseUrl: string | null | undefined;
}

async function fetchReleases(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<ReleaseTag[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
    { signal, headers: { Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) {
    throw new Error(`github releases request failed: ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as ReleaseTag[]) : [];
}

/**
 * Resolve how many releases the running build is behind the latest on its
 * channel. Prefers the authoritative GitHub Releases list; falls back to a
 * conservative semver/nightly delta (which may be `null` when the gap can't
 * be counted from two versions alone). Returns `null` when disabled or
 * indeterminate so callers never hard-block on a guess.
 */
export function useReleasesBehind(args: UseReleasesBehindArgs): number | null {
  const { enabled, currentVersion, latestVersion, channel, updateBaseUrl } = args;
  const repo = parseGithubRepo(updateBaseUrl);
  const queryEnabled = enabled && !!currentVersion && !!repo;

  const { data } = useQuery({
    queryKey: ["forced-upgrade", "releases", repo?.owner, repo?.repo],
    enabled: queryEnabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: ({ signal }) => fetchReleases(repo!.owner, repo!.repo, signal),
  });

  if (!enabled || !currentVersion) return null;
  if (data) return countReleasesBehind(data, currentVersion, channel);
  if (latestVersion) return fallbackReleasesBehind(currentVersion, latestVersion);
  return null;
}
