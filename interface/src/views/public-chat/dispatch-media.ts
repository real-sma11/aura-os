/**
 * Media-mode dispatcher for the logged-out chat surface.
 *
 * The Phase 3 `usePublicChat` hook routes Image / Video / 3D pill
 * sends through this module so the orchestration hook itself stays
 * under the rules-react ~200-line target (per the plan's split
 * trigger). Chat dispatch (Code / Plan) keeps living inline in the
 * hook because its harness-stream-style accumulation does not share
 * shape with the media completion path.
 *
 * Each call:
 *
 * 1. Opens the matching `streamPublic*` SSE client.
 * 2. Updates the stream-store progress text so the live bubble
 *    surfaces meaningful state while the upstream renders.
 * 3. Commits the returned asset URL into the public-chat store via
 *    `commitMedia()` when the upstream emits `generation_completed`.
 * 4. Bumps the local turn counter on the trailing `limit` frame.
 */

import {
  isGuestAuthError,
  streamPublicImage,
  streamPublicModel3d,
  streamPublicVideo,
  type PublicMediaProgress,
  type PublicMediaStreamHandle,
} from "../../api/public-chat";
import type { StreamSetters } from "../../shared/types/stream";

/** Stream-store setters this dispatcher writes into. Kept as a
 *  subset of [`StreamSetters`] so the hook can hand in the exact
 *  setters needed without exposing the wider stream-store surface
 *  to this module. */
export interface MediaStreamSetters {
  setIsStreaming: StreamSetters["setIsStreaming"];
  setStreamingText: StreamSetters["setStreamingText"];
  setProgressText: StreamSetters["setProgressText"];
}

/** Media modalities this dispatcher can drive. Mirrors the backend
 *  `PublicModality::{Image, Video, Model3d}` variants. Note that
 *  the input bar uses `"3d"` as the on-screen pill identifier; the
 *  hook is responsible for the `"3d" -> "model3d"` mapping before
 *  it reaches this module. */
export type MediaDispatchMode = "image" | "video" | "model3d";

/** Single call into the dispatcher. The shape is deliberately
 *  narrow: the orchestration hook owns the public-chat-store and
 *  drives every UI side-effect via the callbacks; this module is
 *  purely a thin adapter between the SSE clients and those
 *  callbacks. */
export interface DispatchMediaArgs {
  mode: MediaDispatchMode;
  token: string;
  prompt: string;
  sourceImage?: string;
  setters: MediaStreamSetters;
  onCompleted: (mode: MediaDispatchMode, url: string) => void;
  onLimit: (turnCount: number) => void;
  onError: (err: Error) => void;
  onDone: () => void;
  /** Optional re-mint callback. When supplied, a guest-auth rejection
   *  (stale token after a server-side secret rotation) discards the
   *  cached token, mints a fresh one via this callback, and re-opens
   *  the same media stream exactly once before falling through to
   *  `onError`. Omit it to keep the legacy forward-error behaviour. */
  reauth?: () => Promise<string>;
}

/** Open the media SSE stream and return its abort handle. The handle
 *  delegates to whichever stream is currently live, so a one-shot
 *  re-mint retry transparently rebinds `close()` to the new stream. */
export function dispatchMediaTurn(args: DispatchMediaArgs): PublicMediaStreamHandle {
  const { mode, setters } = args;
  setters.setIsStreaming(true);
  setters.setStreamingText("");
  setters.setProgressText(initialProgressMessage(mode));
  const onProgress = (progress: PublicMediaProgress): void => {
    const message = formatProgress(mode, progress);
    if (message) setters.setProgressText(message);
  };
  const onCompleted = (url: string): void => args.onCompleted(mode, url);

  let current: PublicMediaStreamHandle = { close: () => {} };

  const openStream = (token: string, didRetry: boolean): void => {
    const onError = (err: Error): void => {
      if (!didRetry && args.reauth && isGuestAuthError(err)) {
        args
          .reauth()
          .then((fresh) => openStream(fresh, true))
          .catch((retryErr: unknown) => {
            args.onError(
              retryErr instanceof Error
                ? retryErr
                : new Error("Unable to generate media"),
            );
          });
        return;
      }
      args.onError(err);
    };

    if (mode === "image") {
      current = streamPublicImage({
        token,
        prompt: args.prompt,
        sourceUrl: args.sourceImage,
        onProgress,
        onCompleted,
        onLimit: args.onLimit,
        onError,
        onDone: args.onDone,
      });
      return;
    }
    if (mode === "video") {
      current = streamPublicVideo({
        token,
        prompt: args.prompt,
        onProgress,
        onCompleted,
        onLimit: args.onLimit,
        onError,
        onDone: args.onDone,
      });
      return;
    }
    // model3d — required source image guarded by the hook before we
    // get here, but fall back to an empty string so the runtime
    // contract stays narrow rather than throwing.
    current = streamPublicModel3d({
      token,
      prompt: args.prompt,
      sourceImage: args.sourceImage ?? "",
      onProgress,
      onCompleted,
      onLimit: args.onLimit,
      onError,
      onDone: args.onDone,
    });
  };

  openStream(args.token, false);
  return { close: () => current.close() };
}

function initialProgressMessage(mode: MediaDispatchMode): string {
  switch (mode) {
    case "image":
      return "Generating image…";
    case "video":
      return "Generating video — this can take a couple of minutes…";
    case "model3d":
      return "Generating 3D model…";
  }
}

function formatProgress(mode: MediaDispatchMode, progress: PublicMediaProgress): string | null {
  if (progress.message && progress.message.trim().length > 0) {
    return progress.message;
  }
  if (typeof progress.fraction === "number") {
    const pct = Math.round(progress.fraction * 100);
    if (pct >= 0 && pct <= 100) {
      switch (mode) {
        case "image":
          return `Generating image… ${pct}%`;
        case "video":
          return `Generating video… ${pct}%`;
        case "model3d":
          return `Generating 3D model… ${pct}%`;
      }
    }
  }
  return null;
}
