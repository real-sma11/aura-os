import { apiFetch } from "./core";

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

export const sharesApi = {
  createSessionShare,
};
