import { useCallback } from "react";
import type { SetURLSearchParams } from "react-router-dom";

interface UseNewSessionUrlSyncOptions {
  setSearchParams: SetURLSearchParams;
  /** Side-effects that should fire after the URL is updated, e.g.
   *  swapping the optimistic session row id and resetting the fresh
   *  canvas nonce. */
  onSessionAdopted?: (sessionId: string) => void;
}

/**
 * Builds the `onSessionReady` callback used by the chat-stream hooks.
 * Single writer of `?session=<id>` after the server assigns one on the
 * first send into a fresh canvas.
 */
export function useNewSessionUrlSync(
  opts: UseNewSessionUrlSyncOptions,
): (sessionId: string) => void {
  const { setSearchParams, onSessionAdopted } = opts;

  return useCallback(
    (newSessionId: string) => {
      onSessionAdopted?.(newSessionId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (next.get("session") === newSessionId) return prev;
          next.set("session", newSessionId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, onSessionAdopted],
  );
}
