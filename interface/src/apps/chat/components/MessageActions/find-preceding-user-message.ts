import type { DisplaySessionEvent } from "../../../../shared/types/stream";

/**
 * Walk backwards from the assistant message identified by `assistantId`
 * to the nearest preceding `role === "user"` message and return its
 * text content. Used by the per-turn regenerate action to re-send the
 * prompt that produced a given assistant turn.
 *
 * Optimistic placeholder rows (`temp-` / `stream-` / `optimistic` id
 * prefixes) are skipped so a regenerate triggered mid-stream resolves
 * to the persisted prompt rather than a transient client row. Returns
 * `null` when the assistant message isn't found or no usable user
 * prompt precedes it, so callers can no-op instead of sending an empty
 * turn.
 */
export function findPrecedingUserMessage(
  messages: DisplaySessionEvent[],
  assistantId: string,
): string | null {
  const assistantIndex = messages.findIndex((m) => m.id === assistantId);
  if (assistantIndex < 0) return null;
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate.role !== "user") continue;
    if (isOptimisticId(candidate.id)) continue;
    const content = candidate.content?.trim();
    if (content) return content;
  }
  return null;
}

function isOptimisticId(id: string): boolean {
  return (
    id.startsWith("temp-") ||
    id.startsWith("stream-") ||
    id.startsWith("optimistic")
  );
}
