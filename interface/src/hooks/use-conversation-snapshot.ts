import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStreamEvents } from "./stream/hooks";
import { useStreamStore } from "./stream/store";
import { useMessageStore } from "../stores/message-store";
import type { DisplaySessionEvent } from "../shared/types/stream";

// Opt-in chat-merge tracer. Toggle with
// `localStorage.setItem("aura.debug.chatMerge", "1")` and reload to
// surface the exact stored / stream / merged transitions on every
// recompute. Used to diagnose CEO-chat "user message flickers /
// briefly overwritten" reports — pinpoints which race (stale post-
// stream history clobber, WS-triggered refetch race, message-store
// thread reset, or lastNonEmptyRef cache miss) is firing without
// guessing. Cached at module load so the disabled path is a single
// boolean read; no work happens on the hot render path otherwise.
const CHAT_MERGE_DEBUG_KEY = "aura.debug.chatMerge";
const chatMergeDebugEnabled = ((): boolean => {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage?.getItem(CHAT_MERGE_DEBUG_KEY) === "1"
    );
  } catch {
    return false;
  }
})();

function fingerprint(message: DisplaySessionEvent | undefined): string {
  if (!message) return "<none>";
  const preview = message.content.slice(0, 40).replace(/\s+/g, " ");
  return `${message.role}#${message.id}:"${preview}"`;
}

function chatMergeLog(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (!chatMergeDebugEnabled) return;
  // eslint-disable-next-line no-console -- gated behind localStorage flag
  console.debug(`[aura.chatMerge] ${tag}`, {
    ts: Date.now(),
    ...payload,
  });
}

function contentBlocksMatch(
  first: DisplaySessionEvent["contentBlocks"],
  second: DisplaySessionEvent["contentBlocks"],
): boolean {
  if (first === second) {
    return true;
  }
  if (!first || !second || first.length !== second.length) {
    return false;
  }

  return first.every((block, index) => {
    const other = second[index];
    if (!other || block.type !== other.type) {
      return false;
    }
    if (block.type === "text" && other.type === "text") {
      return block.text === other.text;
    }
    if (block.type === "image" && other.type === "image") {
      return block.media_type === other.media_type && block.data === other.data;
    }
    return false;
  });
}

function isOptimisticLocalMessage(message: DisplaySessionEvent): boolean {
  return message.id.startsWith("temp-") || message.id.startsWith("stream-");
}

function messageContentMatches(
  storedMessage: DisplaySessionEvent,
  streamMessage: DisplaySessionEvent,
): boolean {
  if (
    storedMessage.role !== streamMessage.role ||
    storedMessage.content !== streamMessage.content
  ) {
    return false;
  }

  if (!storedMessage.contentBlocks || !streamMessage.contentBlocks) {
    return true;
  }

  return contentBlocksMatch(storedMessage.contentBlocks, streamMessage.contentBlocks);
}

interface LiveAssistantActivity {
  streamingText: string;
  thinkingText: string;
  hasToolActivity: boolean;
}

function assistantContentMatchesLiveActivity(
  assistantMessage: DisplaySessionEvent | undefined,
  liveActivity: LiveAssistantActivity,
): boolean {
  if (!assistantMessage || assistantMessage.role !== "assistant") {
    return false;
  }

  const liveText = liveActivity.streamingText.trim();
  const assistantText = assistantMessage.content.trim();
  if (!liveText || !assistantText) {
    return false;
  }

  return assistantText.startsWith(liveText) || liveText.startsWith(assistantText);
}

/**
 * Merge stored (persisted) messages with ephemeral stream messages.
 *
 * Strategy:
 *   1. Stream messages whose stable `id` already exists in `stored` are
 *      dropped, and the matched stored indices are recorded as anchors.
 *      These come from `handleEventSaved`, which substitutes the saved
 *      event (with its server-assigned `event_id`) into the stream when
 *      the backend emits `message_end`.
 *   2. If the tail of `stored` sequence-matches the *entire* remaining
 *      stream by role+content, history has fully caught up and every
 *      optimistic stream row can be dropped.
 *   3. Otherwise, an optimistic stream row is content-dedup'd ONLY when
 *      its candidate stored index is positionally anchored — i.e. it sits
 *      immediately next to an already-matched anchor, or is the final
 *      stored row. This prevents a stale older row with identical content
 *      (e.g. a previous "test" message) from silently swallowing the
 *      fresh optimistic bubble the user just sent.
 */
function combineStoredAndStreamMessages(
  storedMessages: DisplaySessionEvent[],
  streamMessages: DisplaySessionEvent[],
  liveActivity: LiveAssistantActivity,
): DisplaySessionEvent[] {
  if (storedMessages.length === 0) {
    chatMergeLog("merge: stream-only (no stored)", {
      streamCount: streamMessages.length,
      streamLast: fingerprint(streamMessages[streamMessages.length - 1]),
    });
    return streamMessages;
  }
  if (streamMessages.length === 0) {
    chatMergeLog("merge: stored-only (no stream)", {
      storedCount: storedMessages.length,
      storedLast: fingerprint(storedMessages[storedMessages.length - 1]),
    });
    return storedMessages;
  }

  const storedIndexById = new Map<string, number>();
  storedMessages.forEach((message, index) => {
    storedIndexById.set(message.id, index);
  });

  const matchedStoredIndexes = new Set<number>();
  const streamAfterIdDedup: DisplaySessionEvent[] = [];
  for (const message of streamMessages) {
    const matchedIndex = storedIndexById.get(message.id);
    if (matchedIndex !== undefined) {
      matchedStoredIndexes.add(matchedIndex);
      continue;
    }
    streamAfterIdDedup.push(message);
  }

  if (streamAfterIdDedup.length === 0) {
    chatMergeLog("merge: stored wins (every stream id matched)", {
      storedCount: storedMessages.length,
      streamCount: streamMessages.length,
      idMatches: matchedStoredIndexes.size,
    });
    return storedMessages;
  }

  if (streamAfterIdDedup.length <= storedMessages.length) {
    const offset = storedMessages.length - streamAfterIdDedup.length;
    let tailMatches = true;
    for (let i = 0; i < streamAfterIdDedup.length; i += 1) {
      if (!messageContentMatches(storedMessages[offset + i], streamAfterIdDedup[i])) {
        tailMatches = false;
        break;
      }
    }
    if (tailMatches) {
      chatMergeLog("merge: stored wins (tail content-matches stream)", {
        storedCount: storedMessages.length,
        streamCount: streamMessages.length,
        offset,
        suppressedStreamLast: fingerprint(
          streamAfterIdDedup[streamAfterIdDedup.length - 1],
        ),
      });
      return storedMessages;
    }
  }

  const liveOnlyMessages: DisplaySessionEvent[] = [];
  for (let streamIdx = 0; streamIdx < streamAfterIdDedup.length; streamIdx += 1) {
    const message = streamAfterIdDedup[streamIdx];
    if (!isOptimisticLocalMessage(message)) {
      liveOnlyMessages.push(message);
      continue;
    }

    let matched = -1;
    for (let index = storedMessages.length - 1; index >= 0; index -= 1) {
      if (matchedStoredIndexes.has(index)) continue;
      if (!messageContentMatches(storedMessages[index], message)) continue;

      // Anchor the leading stream row to stored[0] when nothing has matched
      // yet AND the stream represents a multi-row turn (user+assistant or
      // user+tool). Without this branch, a [user-temp, asst-stream] stream
      // paired with [user-real, asst-real] history — both length 2 but
      // content-mismatched on the assistant slot, so tail-matching fails —
      // leaves the user at index 0 unable to anchor (it isn't last and has
      // no matched neighbour), which is why optimistic user prompts used
      // to land in `liveOnlyMessages` while every back-walk-matched
      // assistant got dropped, manifesting as "user prompt remains, all
      // assistant content gone" right when the turn finishes.
      //
      // The `streamAfterIdDedup.length >= 2` gate keeps the original guard
      // for "lone optimistic bubble whose content happens to repeat older
      // history" (covered by the "still renders a fresh optimistic bubble
      // when identical content exists earlier in history" test): if the
      // user typed the same prompt twice and the stream only carries that
      // bubble (no following assistant row yet), we still treat it as
      // genuinely live.
      const isFirstUnmatchedHead =
        streamIdx === 0 &&
        index === 0 &&
        matchedStoredIndexes.size === 0 &&
        streamAfterIdDedup.length >= 2;
      const isCurrentLiveAssistantTail =
        streamAfterIdDedup.length === 1 &&
        streamIdx === 0 &&
        message.role === "user" &&
        index === storedMessages.length - 2 &&
        assistantContentMatchesLiveActivity(storedMessages[index + 1], liveActivity);
      const isAnchored =
        matchedStoredIndexes.has(index - 1) ||
        matchedStoredIndexes.has(index + 1) ||
        index === storedMessages.length - 1 ||
        isFirstUnmatchedHead ||
        isCurrentLiveAssistantTail;
      if (isAnchored) {
        matched = index;
        break;
      }
    }

    if (matched !== -1) {
      matchedStoredIndexes.add(matched);
    } else {
      liveOnlyMessages.push(message);
    }
  }

  if (liveOnlyMessages.length === 0) {
    chatMergeLog("merge: stored wins (every optimistic anchored)", {
      storedCount: storedMessages.length,
      streamCount: streamMessages.length,
      anchored: matchedStoredIndexes.size,
    });
    return storedMessages;
  }
  chatMergeLog("merge: appending live-only optimistic rows", {
    storedCount: storedMessages.length,
    streamCount: streamMessages.length,
    liveOnlyCount: liveOnlyMessages.length,
    liveOnlyLast: fingerprint(liveOnlyMessages[liveOnlyMessages.length - 1]),
  });
  return [...storedMessages, ...liveOnlyMessages];
}

/**
 * Defensive splice: when the just-merged `messages` array ends with an
 * optimistic local user prompt — the canonical "user just clicked Send"
 * frame — and the previous-frame cache for the same `transcriptKey`
 * carries a persisted prior assistant that's gone missing from the new
 * merge, splice the cached persisted entries back into the result before
 * the trailing optimistic prompt.
 *
 * This is a backstop against transient flaps in the merge inputs that I
 * could not pin down to a single race in static analysis: a WS-driven
 * force-fetch returning a mid-persistence snapshot, message-store thread
 * being temporarily replaced by an in-flight `setThread`, or a stream
 * entry losing its prior assistant due to LRU eviction or shared-key
 * pruning all manifest as the same symptom — "previous answer gets
 * overwritten for a frame on send, then reappears at end of turn." Rather
 * than chase each race independently, we observe the end-state invariant
 * (the prior turn cannot disappear *just* because the user is in the act
 * of sending the next one) and enforce it here.
 *
 * Scope is intentionally narrow:
 *   1. Trigger only when `merged`'s last entry is an optimistic local
 *      user message (id starts with `temp-` or `stream-`). Any other
 *      tail means we're outside the "Send was just clicked" window and
 *      the merge result should be trusted as-is.
 *   2. Only reinstate persisted (non-optimistic) entries; we never
 *      resurrect cached optimistic ids since those are local-only and
 *      naturally churn.
 *   3. Walk `cached` in order so the spliced result preserves
 *      chronological ordering even when several persisted entries went
 *      missing from `merged` simultaneously.
 *
 * Because the trigger is keyed on the trailing optimistic user prompt,
 * idle (between-turn) refreshes — including legitimate server-side
 * deletions that drop a prior assistant from history — pass through the
 * reinstatement no-op branch and trust the merge.
 */
function reinstateMissingPersistedOnSend(
  merged: DisplaySessionEvent[],
  cached: DisplaySessionEvent[],
): DisplaySessionEvent[] {
  if (merged.length === 0 || cached.length === 0) return merged;

  const last = merged[merged.length - 1];
  if (last.role !== "user" || !isOptimisticLocalMessage(last)) {
    return merged;
  }

  const mergedIds = new Set<string>();
  for (const m of merged) mergedIds.add(m.id);

  let hasMissing = false;
  for (const cm of cached) {
    if (isOptimisticLocalMessage(cm)) continue;
    if (!mergedIds.has(cm.id)) {
      hasMissing = true;
      break;
    }
  }
  if (!hasMissing) return merged;

  const result: DisplaySessionEvent[] = [];
  let mi = 0;

  // Walk `cached` order; for each entry, either pull merged entries up
  // to and including its match, or splice the cached persisted entry
  // in. Optimistic cached entries are skipped (they correspond to the
  // *previous* render's tail, not the current one).
  for (const cm of cached) {
    if (mergedIds.has(cm.id)) {
      while (mi < merged.length) {
        const me = merged[mi];
        result.push(me);
        mi += 1;
        if (me.id === cm.id) break;
      }
      continue;
    }
    if (isOptimisticLocalMessage(cm)) continue;
    result.push(cm);
  }

  // Append remaining merged entries that weren't covered by the cached
  // walk — typically the trailing optimistic user prompt the user just
  // sent, plus any newer entries (a fresh stream-... assistant
  // placeholder if streaming has already begun this frame).
  const resultIds = new Set<string>();
  for (const m of result) resultIds.add(m.id);
  while (mi < merged.length) {
    const me = merged[mi];
    if (!resultIds.has(me.id)) result.push(me);
    mi += 1;
  }

  return result;
}

const EMPTY_MESSAGES: DisplaySessionEvent[] = [];

interface UseConversationSnapshotOptions {
  streamKey: string;
  transcriptKey: string;
  historyMessages?: DisplaySessionEvent[];
}

export function useConversationSnapshot({
  streamKey,
  transcriptKey,
  historyMessages,
}: UseConversationSnapshotOptions): {
  messages: DisplaySessionEvent[];
} {
  useEffect(() => {
    if (historyMessages && historyMessages.length > 0) {
      useMessageStore.getState().setThread(transcriptKey, historyMessages);
    }
  }, [transcriptKey, historyMessages]);

  const streamMessages = useStreamEvents(streamKey);
  const liveActivity = useStreamStore(
    useShallow((state) => {
      const entry = state.entries[streamKey];
      return {
        streamingText: entry?.streamingText ?? "",
        thinkingText: entry?.thinkingText ?? "",
        hasToolActivity:
          (entry?.activeToolCalls.length ?? 0) > 0 ||
          (entry?.timeline.length ?? 0) > 0 ||
          !!entry?.progressText,
      };
    }),
  );

  // Last non-empty merged result, tied to the current `transcriptKey`. Acts as
  // a safety net against transient mid-turn empty frames where every input
  // (history, stream events, message-store thread) momentarily reads empty
  // even though a populated transcript exists. This was the symptom of the
  // CEO chat blink: between a sidebar prefetch evicting the active history
  // entry (`MAX_HISTORY_ENTRIES = 8` in chat-history-store) and the next
  // refetch repopulating it, `historyMessages` flips to `[]`. Concurrently,
  // `useChatHistorySync`'s post-stream "history caught up" effect resets
  // the stream-store events to `[]`. If those land in the same render
  // before `useConversationSnapshot`'s `setThread` effect re-syncs the
  // message-store from the new history, the merged `messages` would
  // briefly be `[]` and `ChatMessageList` would render its empty state —
  // visually dropping the entire transcript for ~1-2 frames. The ref is
  // reset on real transcript switches by keying it on `transcriptKey`.
  const lastNonEmptyRef = useRef<{ key: string; messages: DisplaySessionEvent[] }>({
    key: transcriptKey,
    messages: EMPTY_MESSAGES,
  });

  const messages = useMemo(() => {
    const stored = useMessageStore.getState().getThreadMessages(transcriptKey);
    const usedSource = stored.length > 0 ? "messageStore" : "historyProp";
    const baseStored = stored.length > 0 ? stored : historyMessages ?? [];
    const merged = combineStoredAndStreamMessages(
      baseStored,
      streamMessages,
      liveActivity,
    );

    if (merged.length > 0) {
      const cached =
        lastNonEmptyRef.current.key === transcriptKey
          ? lastNonEmptyRef.current.messages
          : EMPTY_MESSAGES;
      const reinstated = reinstateMissingPersistedOnSend(merged, cached);
      if (reinstated !== merged) {
        chatMergeLog("snapshot: merged populated (reinstated prior persisted)", {
          streamKey,
          transcriptKey,
          usedSource,
          baseStoredCount: baseStored.length,
          streamCount: streamMessages.length,
          mergedCount: merged.length,
          reinstatedCount: reinstated.length,
          mergedLast: fingerprint(merged[merged.length - 1]),
          reinstatedLast: fingerprint(reinstated[reinstated.length - 1]),
        });
        return reinstated;
      }
      chatMergeLog("snapshot: merged populated", {
        streamKey,
        transcriptKey,
        usedSource,
        baseStoredCount: baseStored.length,
        streamCount: streamMessages.length,
        mergedCount: merged.length,
        mergedLast: fingerprint(merged[merged.length - 1]),
      });
      return merged;
    }

    // Empty merged result — fall back to the last non-empty snapshot for
    // the same `transcriptKey` if we have one. This keeps the prior transcript
    // visible across a transient empty frame instead of flashing to the
    // empty state. On a brand-new chat (no prior snapshot), the cache is
    // also empty so we still return the legitimately-empty `merged`.
    const cacheHit =
      lastNonEmptyRef.current.key === transcriptKey &&
      lastNonEmptyRef.current.messages.length > 0;
    chatMergeLog("snapshot: merged EMPTY", {
      streamKey,
      transcriptKey,
      usedSource,
      baseStoredCount: baseStored.length,
      streamCount: streamMessages.length,
      historyPropCount: historyMessages?.length ?? 0,
      cacheHit,
      cacheLast: cacheHit
        ? fingerprint(
            lastNonEmptyRef.current.messages[
              lastNonEmptyRef.current.messages.length - 1
            ],
          )
        : "<none>",
    });
    return cacheHit ? lastNonEmptyRef.current.messages : merged;
  }, [streamKey, transcriptKey, streamMessages, historyMessages, liveActivity]);

  // Keep the cache in sync after each commit. Doing this in an effect
  // (instead of inline in `useMemo`) keeps the memo a pure function of its
  // deps so React's render-phase invariants hold (Strict Mode double
  // render, concurrent renders that get discarded, etc.). The cache is
  // only updated for the *current* `transcriptKey`; transcript switches reset it to
  // an empty payload so the new chat never inherits a previous chat's tail.
  useEffect(() => {
    if (lastNonEmptyRef.current.key !== transcriptKey) {
      lastNonEmptyRef.current = { key: transcriptKey, messages: EMPTY_MESSAGES };
    }
    if (messages.length > 0) {
      lastNonEmptyRef.current = { key: transcriptKey, messages };
    }
  }, [transcriptKey, messages]);

  return { messages };
}
