/**
 * Browser-side client for the marketing `/feedback` page.
 *
 * Originally ported from `aura-web/src/server/feedback.ts`, which ran as a
 * Next.js Server Component and read `process.env.AURA_NETWORK_URL` in the
 * Node process. The first SPA port pushed that fetch into the browser and
 * required a build-time `VITE_AURA_NETWORK_URL`, which left default builds
 * with no roadmap data.
 *
 * The SPA now talks to the main `aura-os-server` instead: it exposes a
 * same-origin pass-through at `GET /api/public/feedback` that proxies to
 * aura-network using the server-side `AURA_NETWORK_URL` (or
 * `AURA_NETWORK_FEEDBACK_URL`). That mirrors aura-web's RSC model — the
 * upstream URL stays a server secret, the browser just hits its own
 * origin.
 *
 * Endpoint contract:
 *   - Unauthenticated. Returns an empty array when aura-network is not
 *     configured on the server.
 *   - Same wire shape (`PublicFeedbackEntryResponse`) as aura-network's
 *     `GET /api/public/feedback`, so `coerceEntry` is unchanged.
 *   - Accepts `sort`, `category`, `status`, `limit` query params; unknown
 *     values are dropped server-side and fall back to "latest".
 */

import { resolveApiUrl } from "../../shared/lib/host-config";

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
  const sort = normalizeSort(params.sort ?? null);
  const category = normalizeCategory(params.category ?? null);
  const status = normalizeStatus(params.status ?? null);
  const limit = Math.max(1, Math.min(params.limit ?? 100, 200));

  const search = new URLSearchParams();
  search.set("sort", sort);
  search.set("limit", String(limit));
  if (category) search.set("category", category);
  if (status) search.set("status", status);

  const url = `${resolveApiUrl("/api/public/feedback")}?${search.toString()}`;

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
