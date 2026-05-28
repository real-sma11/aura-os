/**
 * Client-side fetch for the desktop download manifest published by the
 * release workflows to GitHub Pages
 * (`https://cypher-asi.github.io/aura-os/downloads/{channel}.json`).
 *
 * The manifest is produced by `.github/workflows/release-nightly.yml`
 * / `release-stable.yml` and has this shape (see
 * `infra/scripts/release/desktop-downloads-validate.mjs` for the
 * schema check):
 *
 *     {
 *       "channel": "nightly" | "stable",
 *       "version": "0.1.0-nightly.562.1",
 *       "release_url": "https://github.com/.../releases/tag/...",
 *       "generated_at": "...",
 *       "desktop": {
 *         "windows": { "url": "...x64-setup.exe" },
 *         "mac": {
 *           "apple-silicon": { "url": "...aarch64.dmg" },
 *           "intel": { "url": "...x64.dmg" }
 *         },
 *         "linux": { "url": "...x86_64.AppImage" }
 *       }
 *     }
 *
 * Used by the marketing changelog page so clicking the current version
 * name can auto-download the right installer for the visitor's OS.
 * Mirrors the legacy aura-web `/download/auto` server route, just
 * client-side because the SPA has no Next.js handler.
 */

import type { DownloadPlatform } from "../../lib/download-targets";

export const DESKTOP_MANIFEST_CHANNELS = ["nightly", "stable"] as const;
export type DesktopManifestChannel = (typeof DESKTOP_MANIFEST_CHANNELS)[number];

export interface DesktopManifestTarget {
  readonly url?: string;
}

export interface DesktopManifest {
  readonly channel?: string;
  readonly version?: string;
  readonly release_url?: string;
  readonly generated_at?: string;
  readonly desktop?: {
    readonly windows?: DesktopManifestTarget;
    readonly linux?: DesktopManifestTarget;
    readonly mac?: {
      readonly "apple-silicon"?: DesktopManifestTarget;
      readonly intel?: DesktopManifestTarget;
    };
  };
}

const DEFAULT_DESKTOP_MANIFEST_BASE_URL =
  "https://cypher-asi.github.io/aura-os/downloads";

function getManifestBaseUrl(): string {
  const raw = import.meta.env.VITE_DESKTOP_MANIFEST_BASE_URL;
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return DEFAULT_DESKTOP_MANIFEST_BASE_URL;
}

export function getDesktopManifestUrl(channel: DesktopManifestChannel): string {
  return `${getManifestBaseUrl()}/${channel}.json`;
}

/**
 * Fetch the desktop manifest for the given channel. Returns
 * `undefined` on any failure (network error, 404, malformed JSON) so
 * callers can fall back to a neutral destination instead of throwing
 * from a click handler.
 */
export async function fetchDesktopManifest(
  channel: DesktopManifestChannel = "nightly",
  signal?: AbortSignal,
): Promise<DesktopManifest | undefined> {
  try {
    const response = await fetch(getDesktopManifestUrl(channel), { signal });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as DesktopManifest;
    if (!body || typeof body !== "object") {
      return undefined;
    }
    return body;
  } catch {
    return undefined;
  }
}

/**
 * Pick the best download URL for the visitor's OS from a manifest:
 * direct installer for Windows / Linux, the GitHub releases page for
 * Mac (the JS runtime can't tell apple-silicon from Intel reliably,
 * so we punt to the release page where the user can pick the right
 * dmg), and the release page for unknown platforms.
 *
 * `entryReleaseUrl` is the changelog entry's own `releaseUrl` and is
 * used as a last-resort fallback when the manifest isn't available
 * (e.g. the gh-pages manifest hasn't been published yet for a freshly
 * pushed release).
 */
export function resolveAutoDownloadUrl(
  manifest: DesktopManifest | undefined,
  platform: DownloadPlatform,
  entryReleaseUrl: string | null | undefined,
): string | undefined {
  if (platform === "windows") {
    const url = manifest?.desktop?.windows?.url;
    if (url) return url;
  }

  if (platform === "linux") {
    const url = manifest?.desktop?.linux?.url;
    if (url) return url;
  }

  return manifest?.release_url ?? entryReleaseUrl ?? undefined;
}
