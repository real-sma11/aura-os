/**
 * Client-side download-target detection for the marketing surface.
 *
 * Ported from the original `aura-web` (`src/components/Hero/Hero.tsx`
 * + `src/config/downloadTargets.ts`) so the SPA can do the same
 * "auto-detect my OS and pick the right installer" routing that the
 * legacy Next.js site did at the `/download/auto` route. Because the
 * SPA has no server-side handler we resolve the platform entirely on
 * the client and let the caller (e.g. the changelog "current version"
 * button) navigate to the right URL.
 *
 * `userAgentData.platform` is the modern Client Hint replacement for
 * `navigator.platform`; we read both and fall back to `userAgent` so we
 * still work in browsers that haven't shipped the new API.
 */

export const DOWNLOAD_TARGETS = ["windows", "mac", "linux"] as const;

export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number];

export type DownloadPlatform = DownloadTarget | "unknown";

const DOWNLOAD_TARGET_SET = new Set<string>(DOWNLOAD_TARGETS);

export function normalizeDownloadTarget(
  target: string | null | undefined,
): DownloadTarget | undefined {
  if (!target) {
    return undefined;
  }
  const lower = target.toLowerCase();
  return DOWNLOAD_TARGET_SET.has(lower) ? (lower as DownloadTarget) : undefined;
}

interface NavigatorWithUaData extends Navigator {
  readonly userAgentData?: {
    readonly platform?: string;
  };
}

/**
 * Resolve the visitor's OS from the browser's navigator object. Pulls
 * from `userAgentData.platform`, `navigator.platform`, and the raw
 * `navigator.userAgent` so the heuristic stays the same on browsers
 * that have already migrated off the deprecated `platform` field.
 *
 * Returns `"unknown"` when none of the strings carry a recognizable OS
 * hint (e.g. SSR, oddball user agents) so callers can fall back to a
 * neutral destination instead of guessing.
 */
export function detectDownloadPlatform(): DownloadPlatform {
  if (typeof window === "undefined" || typeof window.navigator === "undefined") {
    return "unknown";
  }

  const navigatorRef = window.navigator as NavigatorWithUaData;
  const probe = [
    navigatorRef.userAgentData?.platform,
    navigatorRef.platform,
    navigatorRef.userAgent,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (probe.includes("win")) {
    return "windows";
  }

  if (
    probe.includes("mac") ||
    probe.includes("iphone") ||
    probe.includes("ipad") ||
    probe.includes("ipod")
  ) {
    return "mac";
  }

  if (
    probe.includes("linux") ||
    probe.includes("x11") ||
    probe.includes("ubuntu")
  ) {
    return "linux";
  }

  return "unknown";
}
