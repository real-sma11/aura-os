import { ApiClientError, apiFetch } from "./core";
import { authHeaders } from "../../shared/lib/auth-token";
import { resolveApiUrl } from "../../shared/lib/host-config";
import type { ApiError } from "../types";

/**
 * Per-project visual customization persisted as
 * `<workspace>/.aura/appearance.json` on the server. Every field is
 * optional — a brand-new project returns an empty object, and the UI
 * treats unset values as "use the default."
 */
export interface ProjectAppearance {
  /** Hex color like `#7c3aed`. */
  accent?: string;
  /** Lucide icon name, e.g. `"Rocket"`. */
  icon?: string;
  background?: {
    /** Hex color for the background tint. */
    color?: string;
    /** Pattern overlay drawn on top of the color. */
    pattern?:
      | "none"
      | "dots"
      | "grid"
      | "diagonal"
      | "noise"
      | "radial";
    /** 0..1. Applied to the composited pattern, not the color. */
    opacity?: number;
  };
}

export interface UploadBannerResponse {
  bannerUrl: string;
}

/**
 * Build the GET URL for a project's banner. Always returns the same
 * path regardless of underlying file extension — the server probes
 * `.png` then `.jpg` and returns the right content type, so callers
 * can use this URL as an `<img src>` without knowing the format.
 *
 * The frontend should treat a 404 from this URL as "no banner set"
 * and render a fallback header instead of an error.
 */
export function projectBannerUrl(projectId: string): string {
  return `/api/projects/${projectId}/appearance/banner`;
}

export const appearanceApi = {
  /**
   * Fetch the project's appearance JSON. Returns `{}` (an empty
   * object) when the project has no customization yet — callers don't
   * need to special-case 404.
   */
  get: (projectId: string) =>
    apiFetch<ProjectAppearance>(`/api/projects/${projectId}/appearance`),

  /**
   * Replace the project's appearance JSON wholesale. The server
   * doesn't merge — callers pass the full desired shape and the
   * server writes it atomically.
   */
  update: (projectId: string, appearance: ProjectAppearance) =>
    apiFetch<ProjectAppearance>(`/api/projects/${projectId}/appearance`, {
      method: "PUT",
      body: JSON.stringify(appearance),
    }),

  /**
   * Upload a PNG or JPEG banner. Sends the raw blob with the right
   * MIME type so the server can stream straight to disk without
   * base64 round-tripping. Magic bytes are validated server-side.
   */
  uploadBanner: async (
    projectId: string,
    blob: Blob,
  ): Promise<UploadBannerResponse> => {
    const res = await fetch(
      resolveApiUrl(`/api/projects/${projectId}/appearance/banner`),
      {
        method: "PUT",
        headers: {
          "Content-Type": blob.type || "application/octet-stream",
          ...authHeaders(),
        },
        body: blob,
      },
    );
    if (!res.ok) {
      const err: ApiError = await res.json().catch(() => ({
        error: res.statusText,
        code: "unknown",
        details: null,
      }));
      throw new ApiClientError(res.status, err);
    }
    return res.json();
  },

  deleteBanner: (projectId: string) =>
    apiFetch<{ deleted: boolean }>(
      `/api/projects/${projectId}/appearance/banner`,
      { method: "DELETE" },
    ),
};
