/*
 * Download target / variant catalog ported from
 * `aura-web/src/config/downloadTargets.ts`. The aura-web copy is
 * shared between client components and Next.js server routes; the
 * aura-os interface is a Vite SPA without server routes, so this
 * port only carries the slice that `DownloadCards` consumes — the
 * type catalog and the `getMacDownloadPath` URL builder. Per-target
 * redirects (`/download/windows`, `/download/linux`,
 * `/download/mac/<variant>`) resolve at the hosting layer (same
 * deployment posture as the existing ported marketing pages, which
 * already link to `/download` and the per-platform paths).
 */

export const DOWNLOAD_TARGETS = ["windows", "mac", "linux"] as const;
export const MAC_DOWNLOAD_VARIANTS = ["apple-silicon", "intel"] as const;

export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number];
export type MacDownloadVariant = (typeof MAC_DOWNLOAD_VARIANTS)[number];

export function getMacDownloadPath(variant?: MacDownloadVariant): string {
  return variant ? `/download/mac/${variant}` : "/download/mac";
}
