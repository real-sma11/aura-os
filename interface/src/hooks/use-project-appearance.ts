import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useProjectAppearanceStore } from "../stores/project-appearance-store";
import { projectBannerUrl } from "../shared/api/appearance";
import type { ProjectAppearance } from "../shared/api/appearance";

/**
 * Read-and-write hook for a single project's appearance. Triggers a
 * load on first mount, then keeps the consumer subscribed to the
 * store entry for live updates from anywhere else in the app (e.g.
 * the settings modal saves accent → the sidebar's pip recolors in
 * the same tick).
 *
 * Returns `undefined` for `projectId === null` so callers in
 * not-yet-routed contexts (e.g. the projects list) can call the hook
 * unconditionally.
 */
export interface UseProjectAppearanceResult {
  appearance: ProjectAppearance;
  loaded: boolean;
  loading: boolean;
  /** URL to the project's banner image, with a cache-bust query
   *  param that flips on upload/delete so `<img>` re-fetches. The URL
   *  always points at the same endpoint regardless of whether a
   *  banner is set — the consumer should treat a 404 as "no banner". */
  bannerUrl: string;
  update: (next: ProjectAppearance) => Promise<void>;
  uploadBanner: (blob: Blob) => Promise<void>;
  deleteBanner: () => Promise<void>;
}

export function useProjectAppearance(
  projectId: string | null | undefined,
): UseProjectAppearanceResult {
  const load = useProjectAppearanceStore((s) => s.load);

  useEffect(() => {
    if (!projectId) return;
    void load(projectId);
  }, [projectId, load]);

  const entry = useProjectAppearanceStore(
    useShallow((s) => {
      if (!projectId) return null;
      return s.entries.get(projectId) ?? null;
    }),
  );

  const updateStore = useProjectAppearanceStore((s) => s.update);
  const uploadBannerStore = useProjectAppearanceStore((s) => s.uploadBanner);
  const deleteBannerStore = useProjectAppearanceStore((s) => s.deleteBanner);

  const appearance = entry?.appearance ?? {};
  const bannerVersion = entry?.bannerVersion ?? 0;

  return {
    appearance,
    loaded: entry?.loaded ?? false,
    loading: entry?.loading ?? false,
    bannerUrl: projectId
      ? `${projectBannerUrl(projectId)}?v=${bannerVersion}`
      : "",
    update: async (next) => {
      if (!projectId) return;
      await updateStore(projectId, next);
    },
    uploadBanner: async (blob) => {
      if (!projectId) return;
      await uploadBannerStore(projectId, blob);
    },
    deleteBanner: async () => {
      if (!projectId) return;
      await deleteBannerStore(projectId);
    },
  };
}
