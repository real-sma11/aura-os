/**
 * Thin client for the `/api/public/*` anonymous endpoint family.
 *
 * Phase 2 (Code + Plan modes only). The three media modes (image,
 * video, model3d) land in phase 3 and will reuse the same SSE
 * primitives + auth header from this module.
 *
 * Every SSE frame is validated at the boundary (rules-typescript >
 * DATA VALIDATION) before being dispatched to the typed reducers.
 * The bearer token comes from `usePublicChatStore` and is appended
 * to `Authorization` for every call.
 */

import { resolveApiUrl } from "../shared/lib/host-config";
import { streamSSE } from "../shared/api/sse";

/** Response shape of `POST /api/public/setup`. */
export interface PublicSetupResponse {
  token: string;
  turn_count: number;
  limit: number;
}

/** Mode dispatch toggle. Mirrors the backend `PublicChatMode`. */
export type PublicChatMode = "code" | "plan";

/** Wire shape of a single prior turn forwarded to the harness. */
export interface PublicChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Strongly-typed args for `streamPublicChat`. */
export interface StreamPublicChatArgs {
  token: string;
  sessionId: string;
  history: PublicChatTurn[];
  message: string;
  mode: PublicChatMode;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onLimit: (turnCount: number) => void;
  onError: (err: Error) => void;
  onDone?: () => void;
}

/** Handle returned by `streamPublicChat`. */
export interface PublicChatStreamHandle {
  /** Abort the SSE read in flight. Safe to call multiple times. */
  close: () => void;
}

/**
 * Mint a fresh guest token. Surfaces the live turn count for
 * `localStorage`-resumed sessions to seed the gate correctly.
 */
export async function setupPublicSession(): Promise<PublicSetupResponse> {
  const resolved = resolveApiUrl("/api/public/setup");
  const response = await fetch(resolved, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`public_setup failed (${response.status}): ${text}`);
  }
  const body: unknown = await response.json();
  if (!isPublicSetupResponse(body)) {
    throw new Error("public_setup response did not match expected shape");
  }
  return body;
}

/**
 * Open a server-sent event stream for a single public chat turn.
 * Returns a handle whose `close()` aborts the underlying fetch.
 *
 * Event reducers are intentionally narrow: chat / plan modes only
 * need `text_delta` deltas and the appended `limit` frame.
 * Everything else is ignored at the parse layer rather than fanned
 * out to handlers it can't drive.
 */
export function streamPublicChat(args: StreamPublicChatArgs): PublicChatStreamHandle {
  const controller = new AbortController();
  const externalSignal = args.signal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const body = {
    session_id: args.sessionId,
    history: args.history,
    message: args.message,
    mode: args.mode,
  };
  void streamSSE<string>(
    "/api/public/chat/stream",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify(body),
    },
    {
      onEvent: (eventType, payload) => {
        dispatchPublicSseFrame(eventType, payload, args);
      },
      onError: args.onError,
      onDone: args.onDone,
    },
    controller.signal,
  );
  return {
    close: () => controller.abort(),
  };
}

/**
 * Validate + route a single SSE frame. Validation lives in the
 * boundary helpers (`isTextDeltaFrame`, `isLimitFrame`) so the
 * handler logic never deals with `any`.
 */
function dispatchPublicSseFrame(
  eventType: string,
  payload: unknown,
  args: StreamPublicChatArgs,
): void {
  if (eventType === "text_delta" && isTextDeltaFrame(payload)) {
    args.onDelta(payload.text);
    return;
  }
  if (eventType === "limit" && isLimitFrame(payload)) {
    args.onLimit(payload.turn_count);
    return;
  }
  if (eventType === "error" && isErrorFrame(payload)) {
    args.onError(new Error(payload.message || payload.code || "public chat error"));
  }
}

interface TextDeltaFrame {
  text: string;
}

interface LimitFrame {
  kind: "limit";
  turn_count: number;
  limit: number;
}

interface ErrorFrame {
  code?: string;
  message?: string;
}

function isTextDeltaFrame(value: unknown): value is TextDeltaFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function isLimitFrame(value: unknown): value is LimitFrame {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "limit" &&
    typeof v.turn_count === "number" &&
    typeof v.limit === "number"
  );
}

function isErrorFrame(value: unknown): value is ErrorFrame {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v.code === "string" || typeof v.code === "undefined") &&
    (typeof v.message === "string" || typeof v.message === "undefined")
  );
}

function isPublicSetupResponse(value: unknown): value is PublicSetupResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.token === "string" &&
    typeof v.turn_count === "number" &&
    typeof v.limit === "number"
  );
}
