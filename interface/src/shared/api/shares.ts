import { apiFetch } from "./core";
import { resolveApiUrl } from "../lib/host-config";
import type { SessionEvent } from "../types";

/**
 * Result of creating (or reusing) a public share for a chat session.
 * Mirrors the server's `create_session_share` JSON response:
 * `shareId` is the `t_<32hex>` capability token, `url` is the
 * canonical `https://aura.ai/s/<token>` public link.
 */
export interface SessionShare {
  shareId: string;
  url: string;
}

/** Identifies the session to share. */
export interface CreateSessionShareArgs {
  projectId: string;
  agentInstanceId: string;
  sessionId: string;
}

/**
 * Narrow an `unknown` HTTP response to {@link SessionShare}. The share
 * link is a capability token, so we validate the shape at the boundary
 * rather than trusting the wire — a malformed response surfaces as a
 * thrown error the caller can show instead of copying `undefined` to
 * the clipboard.
 */
function isSessionShare(value: unknown): value is SessionShare {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.shareId === "string" && typeof record.url === "string";
}

/**
 * Create a public share for a chat session, returning the share id and
 * canonical public URL. The endpoint is idempotent server-side: a
 * session that is already public yields its existing token.
 */
export async function createSessionShare({
  projectId,
  agentInstanceId,
  sessionId,
}: CreateSessionShareArgs): Promise<SessionShare> {
  const raw = await apiFetch<unknown>(
    `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/share`,
    { method: "POST" },
  );
  if (!isSessionShare(raw)) {
    throw new Error("Unexpected response from the share endpoint");
  }
  return { shareId: raw.shareId, url: raw.url };
}

/**
 * Capability-token shape for a public share id: `t_` followed by 32
 * lowercase hex chars (a v4 UUID with dashes stripped), matching the
 * server's `format!("t_{}", Uuid::new_v4().simple())`. Validated
 * client-side before any fetch so a malformed `:shareToken` route
 * param never hits the network and surfaces as a plain not-found.
 */
const SHARE_TOKEN_PATTERN = /^t_[0-9a-f]{32}$/;

/** `true` when `token` matches the `t_<32hex>` share-token shape. */
export function isValidShareToken(token: string): boolean {
  return SHARE_TOKEN_PATTERN.test(token);
}

/**
 * Thrown when a public share token is malformed, unknown, or points at
 * a session that is not (or no longer) public — i.e. every case the
 * server collapses to a 404. Distinct from a generic transport error
 * so the viewer can render a friendly "this link is unavailable" state
 * instead of a hard error.
 */
export class ShareNotFoundError extends Error {
  constructor(message = "Shared session not found") {
    super(message);
    this.name = "ShareNotFoundError";
  }
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.event_id === "string" &&
    typeof record.content === "string" &&
    (record.role === "user" ||
      record.role === "assistant" ||
      record.role === "system")
  );
}

function isSessionEventArray(value: unknown): value is SessionEvent[] {
  return Array.isArray(value) && value.every(isSessionEvent);
}

/**
 * Fetch the read-only transcript for a public share token.
 *
 * This is the PUBLIC, unauthenticated read path: the viewer has no
 * credentials, so we use a raw `fetch` (mirroring `setupPublicSession`
 * in `api/public-chat.ts`) and deliberately do NOT route through
 * `apiFetch`, which would attach the caller's `Authorization` header.
 *
 * The token is validated against `t_<32hex>` before any network call,
 * a 404 (unknown token / not public) is surfaced as a typed
 * {@link ShareNotFoundError}, and the JSON body is narrowed to a
 * `SessionEvent[]` at the boundary so a shape mismatch throws rather
 * than feeding malformed data into the renderer.
 */
export async function getPublicShare(token: string): Promise<SessionEvent[]> {
  if (!isValidShareToken(token)) {
    throw new ShareNotFoundError("Invalid share token");
  }
  const response = await fetch(resolveApiUrl(`/api/public/share/${token}`), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (response.status === 404) {
    throw new ShareNotFoundError();
  }
  if (!response.ok) {
    throw new Error(
      `Failed to load shared session (status ${response.status})`,
    );
  }
  const raw: unknown = await response.json();
  if (!isSessionEventArray(raw)) {
    throw new Error("Unexpected response from the public share endpoint");
  }
  return raw;
}

export const sharesApi = {
  createSessionShare,
  getPublicShare,
  isValidShareToken,
};
