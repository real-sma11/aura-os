/**
 * Thin client for the `/api/public/*` anonymous endpoint family.
 *
 * Phase 2 wired Code + Plan; Phase 3 extends this module with three
 * media-mode SSE clients (`streamPublicImage` / `streamPublicVideo`
 * / `streamPublicModel3d`) sitting on top of the same
 * [`streamSSE`] primitive and the same bearer-auth header.
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

/* ── Phase 3: media-mode SSE clients ──────────────────────────────── */

/** Public-mode media modalities. Mirrors the backend
 *  `PublicModality::{Image, Video, Model3d}` variants. */
export type PublicMediaKind = "image" | "video" | "model3d";

/** Progress update fanned out from a media-mode stream. Both fields
 *  are optional — the upstream router emits `progress` frames with
 *  either a `percent` number or a free-text `message` (or both). */
export interface PublicMediaProgress {
  fraction?: number;
  message?: string;
}

/** Shared args for the three media-mode SSE clients. Each client
 *  applies one additional field on top of this shape (image's
 *  optional `sourceUrl` is threaded through the body). */
interface StreamPublicMediaArgsBase {
  token: string;
  prompt: string;
  signal?: AbortSignal;
  onProgress: (progress: PublicMediaProgress) => void;
  onCompleted: (url: string) => void;
  onLimit: (turnCount: number) => void;
  onError: (err: Error) => void;
  onDone?: () => void;
}

export interface StreamPublicImageArgs extends StreamPublicMediaArgsBase {
  /** Optional source image URL for image-to-image generation. */
  sourceUrl?: string;
}

export type StreamPublicVideoArgs = StreamPublicMediaArgsBase;

export interface StreamPublicModel3dArgs extends StreamPublicMediaArgsBase {
  /** Required source image for the Tripo image-to-3D pipeline. Either
   *  a fully-resolved URL or a `data:image/...;base64,...` URL — the
   *  backend accepts both via the `image_data` alias. */
  sourceImage: string;
}

/** Handle returned by the three media-mode stream clients. Identical
 *  to [`PublicChatStreamHandle`] but kept as a distinct name to
 *  document intent at call sites. */
export interface PublicMediaStreamHandle {
  close: () => void;
}

/** Open the public image-generation SSE stream. */
export function streamPublicImage(args: StreamPublicImageArgs): PublicMediaStreamHandle {
  const body: Record<string, unknown> = { prompt: args.prompt };
  if (args.sourceUrl && args.sourceUrl.trim().length > 0) {
    body.source_url = args.sourceUrl;
  }
  return openMediaStream({
    args,
    path: "/api/public/generation/image",
    body,
    kind: "image",
  });
}

/** Open the public video-generation SSE stream. */
export function streamPublicVideo(args: StreamPublicVideoArgs): PublicMediaStreamHandle {
  return openMediaStream({
    args,
    path: "/api/public/generation/video",
    body: { prompt: args.prompt },
    kind: "video",
  });
}

/** Open the public 3D-generation SSE stream. */
export function streamPublicModel3d(args: StreamPublicModel3dArgs): PublicMediaStreamHandle {
  const trimmed = args.sourceImage.trim();
  const body: Record<string, unknown> = { prompt: args.prompt };
  if (trimmed.startsWith("data:")) {
    body.image_data = trimmed;
  } else {
    body.image_url = trimmed;
  }
  return openMediaStream({
    args,
    path: "/api/public/generation/model3d",
    body,
    kind: "model3d",
  });
}

interface OpenMediaStreamArgs {
  args: StreamPublicMediaArgsBase;
  path: string;
  body: Record<string, unknown>;
  kind: PublicMediaKind;
}

/** Shared dispatch core. Mirrors [`streamPublicChat`] but routes
 *  the SSE frames through [`dispatchPublicMediaFrame`]. Kept private
 *  so the public surface is the three named exports above. */
function openMediaStream(opts: OpenMediaStreamArgs): PublicMediaStreamHandle {
  const { args, path, body, kind } = opts;
  const controller = new AbortController();
  const externalSignal = args.signal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  void streamSSE<string>(
    path,
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
        dispatchPublicMediaFrame(eventType, payload, args, kind);
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

/** Validate + route a single SSE frame from one of the media
 *  endpoints. Anything we cannot validate is dropped at the
 *  boundary — `args.onCompleted` is only ever called with a real
 *  string URL. */
function dispatchPublicMediaFrame(
  eventType: string,
  payload: unknown,
  args: StreamPublicMediaArgsBase,
  kind: PublicMediaKind,
): void {
  if (eventType === "generation_progress" && isProgressFrame(payload)) {
    args.onProgress(toProgressUpdate(payload));
    return;
  }
  if (eventType === "generation_completed" && isCompletedFrame(payload)) {
    const url = extractMediaUrl(payload, kind);
    if (url) args.onCompleted(url);
    return;
  }
  if (eventType === "limit" && isLimitFrame(payload)) {
    args.onLimit(payload.turn_count);
    return;
  }
  if (eventType === "generation_error" && isErrorFrame(payload)) {
    args.onError(new Error(payload.message || payload.code || "public generation error"));
    return;
  }
  if (eventType === "error" && isErrorFrame(payload)) {
    args.onError(new Error(payload.message || payload.code || "public generation error"));
  }
}

interface ProgressFrame {
  percent?: number;
  fraction?: number;
  message?: string;
}

interface CompletedFrame {
  imageUrl?: string;
  videoUrl?: string;
  modelUrl?: string;
  url?: string;
  payload?: {
    imageUrl?: string;
    videoUrl?: string;
    modelUrl?: string;
    url?: string;
  };
}

function isProgressFrame(value: unknown): value is ProgressFrame {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.percent === undefined || typeof v.percent === "number") &&
    (v.fraction === undefined || typeof v.fraction === "number") &&
    (v.message === undefined || typeof v.message === "string")
  );
}

function isCompletedFrame(value: unknown): value is CompletedFrame {
  return typeof value === "object" && value !== null;
}

function toProgressUpdate(payload: ProgressFrame): PublicMediaProgress {
  const fraction =
    typeof payload.fraction === "number"
      ? payload.fraction
      : typeof payload.percent === "number"
        ? payload.percent / 100
        : undefined;
  const update: PublicMediaProgress = {};
  if (fraction !== undefined) update.fraction = fraction;
  if (payload.message !== undefined) update.message = payload.message;
  return update;
}

/** Pull the renderable asset URL from a completed-frame payload.
 *  The backend normaliser promotes whichever alias the upstream
 *  used (asset_url / video_url / model_url / url) into `imageUrl`,
 *  so the happy path is a single field read; the explicit fallbacks
 *  keep this client resilient if the contract drifts. */
function extractMediaUrl(payload: CompletedFrame, kind: PublicMediaKind): string | null {
  const direct =
    (kind === "video" ? payload.videoUrl : undefined) ??
    (kind === "model3d" ? payload.modelUrl : undefined) ??
    payload.imageUrl ??
    payload.url;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const nested = payload.payload;
  if (!nested) return null;
  const nestedUrl =
    (kind === "video" ? nested.videoUrl : undefined) ??
    (kind === "model3d" ? nested.modelUrl : undefined) ??
    nested.imageUrl ??
    nested.url;
  return typeof nestedUrl === "string" && nestedUrl.length > 0 ? nestedUrl : null;
}
