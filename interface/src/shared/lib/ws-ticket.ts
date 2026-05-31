import { authHeaders } from "./auth-token";
import { resolveApiUrl } from "./host-config";

/**
 * Mint a short-lived, single-use connect ticket for URL-based auth.
 *
 * Native `WebSocket` handshakes can't carry an `Authorization` header,
 * so the long-lived JWT used to be appended as `?token=<jwt>` — which
 * lands verbatim in every proxy / platform access log (Render records
 * the full request line) and is replayable until it expires. Instead we
 * POST to `/api/auth/ws-ticket` with the JWT in the auth header (never a
 * URL) and get back an opaque ticket that expires server-side in ~30s
 * and is burned on first use. Even if a ticket leaks into a log it is
 * useless to replay.
 *
 * Returns `null` when logged out or if the mint fails, so callers fall
 * back to a tokenless URL (the server will 401 and the normal
 * reconnect/error path handles it) rather than throwing.
 */
export async function mintWsTicket(): Promise<string | null> {
  try {
    const res = await fetch(resolveApiUrl("/api/auth/ws-ticket"), {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ticket?: string };
    return body.ticket ?? null;
  } catch {
    return null;
  }
}

/**
 * Append a freshly-minted connect ticket to a WebSocket URL. No-op
 * (returns the URL unchanged) when no ticket can be minted.
 */
export async function appendWsTicket(url: string): Promise<string> {
  const ticket = await mintWsTicket();
  if (!ticket) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ticket=${encodeURIComponent(ticket)}`;
}
