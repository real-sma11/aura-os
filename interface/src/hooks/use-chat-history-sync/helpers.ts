import type { DisplaySessionEvent } from "../../shared/types/stream";

/**
 * Trailing-edge debounce window for refetches triggered by
 * `assistant_turn_progress` heartbeats. The server already throttles
 * publishes to roughly one every 400ms; this window adds a second
 * coalescing layer so concurrent listeners never produce more than one
 * history fetch per ~250ms while a turn is streaming.
 */
export const PROGRESS_REFETCH_DEBOUNCE_MS = 250;

export function hasTransientStreamError(events: DisplaySessionEvent[]): boolean {
  return events.some((event) =>
    event.id.startsWith("error-") || event.displayVariant != null
  );
}

export function assistantHasVisibleActivity(event: DisplaySessionEvent | undefined): boolean {
  return !!(
    event &&
    event.role === "assistant" &&
    (
      event.content.trim().length > 0 ||
      (event.toolCalls?.length ?? 0) > 0 ||
      (event.timeline?.length ?? 0) > 0 ||
      (event.thinkingText?.trim().length ?? 0) > 0
    )
  );
}

export function findTrailingAssistant(events: DisplaySessionEvent[]): DisplaySessionEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].role === "assistant") {
      return events[index];
    }
  }
  return undefined;
}

export function historyHasCaughtUpToStream(
  historyMessages: DisplaySessionEvent[],
  streamEvents: DisplaySessionEvent[],
): boolean {
  if (historyMessages.length < streamEvents.length) {
    return false;
  }

  const streamAssistant = findTrailingAssistant(streamEvents);
  if (!assistantHasVisibleActivity(streamAssistant)) {
    return true;
  }

  const historyAssistant = findTrailingAssistant(historyMessages);
  if (!assistantHasVisibleActivity(historyAssistant)) {
    return false;
  }

  const streamContent = streamAssistant?.content.trim() ?? "";
  if (!streamContent) {
    return true;
  }

  const historyContent = historyAssistant?.content.trim() ?? "";
  return (
    historyContent.length >= streamContent.length &&
    historyContent.startsWith(streamContent)
  );
}
