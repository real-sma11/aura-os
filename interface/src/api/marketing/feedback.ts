/**
 * Browser-side client for aura-network's public Feedback list.
 *
 * Ported from `aura-web/src/server/feedback.ts`. The source ran as a
 * Next.js Server Component module that hit aura-network from the edge;
 * this port talks to the same `GET /api/public/feedback` endpoint, but
 * from the SPA. The endpoint is unauthenticated.
 *
 * Behavior parity:
 *   - Same `FeedbackSort` / `FeedbackCategory` / `FeedbackStatus` unions,
 *     same `normalizeSort` / `normalizeCategory` / `normalizeStatus`
 *     guards, same `coerceEntry` shape.
 *   - Reads the network base URL from `import.meta.env.VITE_AURA_NETWORK_URL`
 *     (was `process.env.AURA_NETWORK_URL` server-side). Trailing slashes
 *     are stripped so URL composition is predictable.
 *   - Returns `[]` on missing config, non-OK responses, or thrown
 *     fetch/JSON errors; failures are logged via `console.error` (same
 *     verb the source uses).
 */

export type FeedbackSort =
  | "latest"
  | "popular"
  | "trending"
  | "most_voted"
  | "least_voted";

export type FeedbackCategory =
  | "feature_request"
  | "bug"
  | "ui_ux"
  | "feedback"
  | "question";

export type FeedbackStatus =
  | "not_started"
  | "in_review"
  | "in_progress"
  | "done"
  | "deployed";

export interface FeedbackEntry {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly category: FeedbackCategory;
  readonly status: FeedbackStatus;
  readonly upvotes: number;
  readonly downvotes: number;
  readonly voteScore: number;
  readonly commentCount: number;
  readonly createdAt: string;
  readonly authorName: string | null;
  readonly authorAvatar: string | null;
}

export interface ListFeedbackParams {
  readonly sort?: FeedbackSort;
  readonly category?: FeedbackCategory | null;
  readonly status?: FeedbackStatus | null;
  readonly limit?: number;
}

const VALID_SORTS: readonly FeedbackSort[] = [
  "latest",
  "popular",
  "trending",
  "most_voted",
  "least_voted",
];

const VALID_CATEGORIES: readonly FeedbackCategory[] = [
  "feature_request",
  "bug",
  "ui_ux",
  "feedback",
  "question",
];

const VALID_STATUSES: readonly FeedbackStatus[] = [
  "not_started",
  "in_review",
  "in_progress",
  "done",
  "deployed",
];

export function normalizeSort(value: string | undefined | null): FeedbackSort {
  return VALID_SORTS.includes(value as FeedbackSort)
    ? (value as FeedbackSort)
    : "latest";
}

export function normalizeCategory(
  value: string | undefined | null,
): FeedbackCategory | null {
  return VALID_CATEGORIES.includes(value as FeedbackCategory)
    ? (value as FeedbackCategory)
    : null;
}

export function normalizeStatus(
  value: string | undefined | null,
): FeedbackStatus | null {
  return VALID_STATUSES.includes(value as FeedbackStatus)
    ? (value as FeedbackStatus)
    : null;
}

function networkBaseUrl(): string | null {
  const raw = import.meta.env.VITE_AURA_NETWORK_URL?.trim();
  if (!raw) return null;
  // Strip a single trailing slash so URL construction is predictable
  // whether operators set "https://network.aura.ai" or the same with a "/".
  return raw.replace(/\/+$/, "");
}

interface PublicFeedbackEntryResponse {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly status: string;
  readonly upvotes: number;
  readonly downvotes: number;
  readonly voteScore: number;
  readonly commentCount: number;
  readonly createdAt: string;
  readonly authorName: string | null;
  readonly authorAvatar: string | null;
}

function coerceEntry(raw: PublicFeedbackEntryResponse): FeedbackEntry {
  return {
    id: raw.id,
    title: raw.title,
    body: raw.body ?? "",
    // The server already normalizes missing metadata to 'feedback' and
    // 'not_started', but we keep the narrow union on the client so unknown
    // values still flow through unchanged (feedback-constants.ts label
    // maps fall back gracefully).
    category: (raw.category as FeedbackCategory) ?? "feedback",
    status: (raw.status as FeedbackStatus) ?? "not_started",
    upvotes: Number(raw.upvotes) || 0,
    downvotes: Number(raw.downvotes) || 0,
    voteScore: Number(raw.voteScore) || 0,
    commentCount: Number(raw.commentCount) || 0,
    createdAt: raw.createdAt,
    authorName: raw.authorName,
    authorAvatar: raw.authorAvatar,
  };
}

export async function listFeedback(
  params: ListFeedbackParams = {},
): Promise<readonly FeedbackEntry[]> {
  const base = networkBaseUrl();
  if (!base) return [];

  const sort = normalizeSort(params.sort ?? null);
  const category = normalizeCategory(params.category ?? null);
  const status = normalizeStatus(params.status ?? null);
  const limit = Math.max(1, Math.min(params.limit ?? 100, 200));

  const search = new URLSearchParams();
  search.set("sort", sort);
  search.set("limit", String(limit));
  if (category) search.set("category", category);
  if (status) search.set("status", status);

  const url = `${base}/api/public/feedback?${search.toString()}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(
        `[feedback] GET ${url} failed: ${res.status} ${res.statusText}`,
      );
      return [];
    }
    const json = (await res.json()) as PublicFeedbackEntryResponse[];
    if (!Array.isArray(json)) {
      console.error("[feedback] expected array response, got:", typeof json);
      return [];
    }
    return json.map(coerceEntry);
  } catch (err) {
    console.error("[feedback] listFeedback failed", err);
    return [];
  }
}

export function hasNetworkUrl(): boolean {
  return networkBaseUrl() !== null;
}
