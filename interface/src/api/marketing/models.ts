/**
 * Browser-side client for the marketing `/models` page.
 *
 * Talks to the aura-os-server same-origin pass-through at
 * `/api/public/models`, which proxies to aura-network's
 * `/api/public/models`. Same shape and graceful-degrade contract as
 * the sibling `/api/public/feedback` client at
 * `interface/src/api/marketing/feedback.ts` — upstream errors and
 * missing-config scenarios all surface as an empty array so the
 * marketing page renders an empty catalog instead of an error.
 */

import { resolveApiUrl } from "../../shared/lib/host-config";

export type ModelMode = "text" | "image" | "video" | "3d";

export type ModelStatus = "live" | "soon";

export interface ModelEntry {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly provider: string;
  readonly description: string;
  readonly mode: ModelMode;
  readonly status: ModelStatus;
  readonly featured: boolean;
  readonly sortOrder: number;
}

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

interface PublicModelEntryResponse {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly provider: string;
  readonly description: string;
  readonly mode: string;
  readonly status: string;
  readonly featured: boolean;
  readonly sortOrder: number;
}

function coerceEntry(raw: PublicModelEntryResponse): ModelEntry {
  // The server-side CHECK constraint guarantees `mode` and `status`
  // are in the allow-list, but we still narrow with a fallback so a
  // future server change can't break this client at parse time.
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    provider: raw.provider,
    description: raw.description ?? "",
    mode: (normalizeMode(raw.mode) ?? "text") as ModelMode,
    status: (normalizeStatus(raw.status) ?? "live") as ModelStatus,
    featured: Boolean(raw.featured),
    sortOrder: Number(raw.sortOrder) || 0,
  };
}

export async function listModels(
  params: ListModelsParams = {},
): Promise<readonly ModelEntry[]> {
  const mode = normalizeMode(params.mode ?? null);
  const status = normalizeStatus(params.status ?? null);
  const search = (params.search ?? "").trim();

  const query = new URLSearchParams();
  if (mode) query.set("mode", mode);
  if (status) query.set("status", status);
  if (search.length > 0) query.set("q", search);

  const qs = query.toString();
  const url = `${resolveApiUrl("/api/public/models")}${qs ? `?${qs}` : ""}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(
        `[models] GET ${url} failed: ${res.status} ${res.statusText}`,
      );
      return [];
    }
    const json = (await res.json()) as PublicModelEntryResponse[];
    if (!Array.isArray(json)) {
      console.error("[models] expected array response, got:", typeof json);
      return [];
    }
    return json.map(coerceEntry);
  } catch (err) {
    console.error("[models] listModels failed", err);
    return [];
  }
}
