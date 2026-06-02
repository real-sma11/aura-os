/**
 * Per-`streamKey` registry of "regenerate this turn" callbacks.
 *
 * The actual regenerate logic lives at the chat surface
 * (`useChatPanelState.handleRegenerateTurn`) where the send path
 * (`onSend` / `onStop`) and the live message list are available. The
 * surface registers its handler here keyed by `streamKey`, and the
 * colocated `useMessageActions` facade reads it at click time. This
 * mirrors the existing standalone-agent `sendFn` registration pattern
 * (see `partition-state.ts`) and lets the action row reuse the existing
 * send path without threading an `onRegenerate` prop through
 * `ChatMessageList` → `MessageBubble`.
 */
export type RegenerateTurnFn = (assistantMessageId: string) => void;

const registry = new Map<string, RegenerateTurnFn>();

/**
 * Register the regenerate handler for a stream. Returns an unregister
 * function intended to be returned from the caller's `useEffect` so the
 * entry is dropped on unmount / streamKey change.
 */
export function registerRegenerateTurn(
  streamKey: string,
  fn: RegenerateTurnFn,
): () => void {
  registry.set(streamKey, fn);
  return () => {
    if (registry.get(streamKey) === fn) {
      registry.delete(streamKey);
    }
  };
}

/** Read the regenerate handler for a stream, if one is registered. */
export function getRegenerateTurn(
  streamKey: string,
): RegenerateTurnFn | undefined {
  return registry.get(streamKey);
}
