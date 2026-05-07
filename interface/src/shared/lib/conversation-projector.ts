import type { DisplaySessionEvent } from "../types/stream";

/**
 * Pure projector: given the persisted history snapshot and the
 * ephemeral stream events, produce the canonical ordered transcript
 * for `ChatPanel`/`ChatMessageList`.
 *
 * Strategy (single pass, stable identities):
 *
 *   1. Stream events whose `id` already exists in `history` are
 *      dropped: the persisted row is authoritative once it lands.
 *      This covers `handleEventSaved` swapping a `stream-...`
 *      placeholder for the persisted `event_id` *and* the history
 *      refetch overlapping with the in-flight stream.
 *
 *   2. The user prompt is special-cased: the optimistic `temp-...`
 *      user row is dropped when the persisted history tail already
 *      contains a content-equivalent user message. This covers the
 *      "POST returns and the chat-history-store snapshots the new
 *      user row before the stream's `temp-` event has been swapped"
 *      window.
 *
 *   3. Everything else from the stream (assistant placeholder,
 *      finalized assistant rows that haven't been persisted yet) is
 *      appended after the history tail in stream order.
 *
 * No anchor rules, no backstop hacks: the upstream invariants
 * (stable `clientId`, `handleEventSaved` preserves `clientId` across
 * the persisted-id swap) make the dedup deterministic.
 */
export function projectConversation(
  history: readonly DisplaySessionEvent[],
  stream: readonly DisplaySessionEvent[],
): DisplaySessionEvent[] {
  if (stream.length === 0) {
    return history.length === 0 ? EMPTY : history.slice();
  }
  if (history.length === 0) {
    return stream.slice();
  }

  const historyIds = new Set<string>();
  for (const m of history) historyIds.add(m.id);

  const lastHistory = history[history.length - 1];
  // Only dedup the optimistic temp- user against the IMMEDIATELY trailing
  // user in history. If the trailing history row is an assistant, the
  // prompt has already been answered and a content-equal optimistic temp-
  // represents a brand-new send, not a duplicate.
  const trailingPendingUser =
    lastHistory && lastHistory.role === "user" ? lastHistory : null;

  const liveOnly: DisplaySessionEvent[] = [];
  for (const message of stream) {
    if (historyIds.has(message.id)) continue;
    if (
      trailingPendingUser !== null &&
      message.role === "user" &&
      isOptimisticUser(message) &&
      messagesContentEqual(message, trailingPendingUser)
    ) {
      continue;
    }
    liveOnly.push(message);
  }

  if (liveOnly.length === 0) {
    return history.slice();
  }

  return [...history, ...liveOnly];
}

const EMPTY: DisplaySessionEvent[] = [];

function isOptimisticUser(message: DisplaySessionEvent): boolean {
  return message.id.startsWith("temp-");
}

function messagesContentEqual(
  first: DisplaySessionEvent,
  second: DisplaySessionEvent,
): boolean {
  if (first.role !== second.role) return false;
  if (first.content !== second.content) return false;
  return contentBlocksEqual(first.contentBlocks, second.contentBlocks);
}

function contentBlocksEqual(
  first: DisplaySessionEvent["contentBlocks"],
  second: DisplaySessionEvent["contentBlocks"],
): boolean {
  if (first === second) return true;
  if (!first || !second) return !first === !second;
  if (first.length !== second.length) return false;
  for (let i = 0; i < first.length; i += 1) {
    const a = first[i];
    const b = second[i];
    if (!b || a.type !== b.type) return false;
    if (a.type === "text" && b.type === "text") {
      if (a.text !== b.text) return false;
      continue;
    }
    if (a.type === "image" && b.type === "image") {
      if (a.media_type !== b.media_type || a.data !== b.data) return false;
      continue;
    }
    return false;
  }
  return true;
}
