import {
  useContextContents,
  type ContextContents,
} from "../../stores/context-contents-store";

/**
 * Selects the lazily-fetched, camelCased {@link ContextContents} for a
 * stream from the context-contents cache. Returns `undefined` until the
 * Context Composition popover's row click has fetched (or the harness
 * has emitted) contents for `streamKey`, which the preview renders as
 * its "not available from this harness build yet" empty state.
 *
 * Thin by design: it keeps the store-selection orchestration out of the
 * presentational {@link ContextBucketPreview} so the component receives
 * its data through one named hook and stays trivially testable.
 */
export function useContextBucketContents(
  streamKey: string,
): ContextContents | undefined {
  return useContextContents(streamKey);
}
