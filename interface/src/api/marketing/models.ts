/**
 * Catalog source for the marketing `/models` page.
 *
 * The page is driven entirely by the model constants bundled into the
 * app (`interface/src/constants/models.ts`) — the same list chat, image,
 * video, and 3D surfaces use. There is no network fetch: every model the
 * app ships with is known at build time, so the page always renders the
 * full catalog regardless of auth state or backend availability.
 */

import {
  buildMarketingModelEntries,
  type MarketingModelEntry,
  type MarketingModelMode,
  type MarketingModelStatus,
} from "../../constants/models";

export type ModelMode = MarketingModelMode;

export type ModelStatus = MarketingModelStatus;

export type ModelEntry = MarketingModelEntry;

export interface ListModelsParams {
  readonly mode?: ModelMode | null;
  readonly status?: ModelStatus | null;
  readonly search?: string | null;
}

const VALID_MODES: readonly ModelMode[] = ["text", "image", "video", "3d"];
const VALID_STATUSES: readonly ModelStatus[] = ["live", "soon"];

export function normalizeMode(value: string | undefined | null): ModelMode | null {
  return VALID_MODES.includes(value as ModelMode) ? (value as ModelMode) : null;
}

export function normalizeStatus(
  value: string | undefined | null,
): ModelStatus | null {
  return VALID_STATUSES.includes(value as ModelStatus)
    ? (value as ModelStatus)
    : null;
}

/**
 * Returns the bundled model catalog, optionally narrowed by mode,
 * status, and free-text search. Kept `async` so the marketing page can
 * keep loading it through React Query without special-casing a
 * synchronous source.
 */
export async function listModels(
  params: ListModelsParams = {},
): Promise<readonly ModelEntry[]> {
  const mode = normalizeMode(params.mode ?? null);
  const status = normalizeStatus(params.status ?? null);
  const needle = (params.search ?? "").trim().toLowerCase();

  return buildMarketingModelEntries().filter((entry) => {
    if (mode && entry.mode !== mode) return false;
    if (status && entry.status !== status) return false;
    if (needle.length === 0) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.provider.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle)
    );
  });
}
