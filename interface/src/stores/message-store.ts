import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { DisplaySessionEvent } from "../shared/types/stream";

const EMPTY_MESSAGES: DisplaySessionEvent[] = [];
const MAX_MESSAGES_PER_THREAD = 500;

interface MessageStoreState {
  /** Normalized map: message ID -> message */
  messages: Record<string, DisplaySessionEvent>;
  /** Stable ordered array of message IDs per thread key */
  orderedIds: Record<string, string[]>;

  /** Insert messages for a thread (idempotent, appends new messages at end) */
  insertMessages: (threadKey: string, msgs: DisplaySessionEvent[]) => void;
  /** Prepend older messages to the beginning of a thread */
  prependMessages: (threadKey: string, msgs: DisplaySessionEvent[]) => void;
  /** Append a single message to the end of a thread */
  appendMessage: (threadKey: string, msg: DisplaySessionEvent) => void;
  /** Replace all messages for a thread (used on initial history load) */
  setThread: (threadKey: string, msgs: DisplaySessionEvent[]) => void;
  /** Get ordered messages for a thread */
  getThreadMessages: (threadKey: string) => DisplaySessionEvent[];
  /** Clear a thread */
  clearThread: (threadKey: string) => void;
}

function trimThreadIds(ids: string[]): string[] {
  return ids.length > MAX_MESSAGES_PER_THREAD ? ids.slice(-MAX_MESSAGES_PER_THREAD) : ids;
}

function dropUnreferencedMessages(
  messages: Record<string, DisplaySessionEvent>,
  orderedIds: Record<string, string[]>,
): Record<string, DisplaySessionEvent> {
  const retained = new Set<string>();
  for (const ids of Object.values(orderedIds)) {
    for (const id of ids) retained.add(id);
  }
  let changed = false;
  const next = { ...messages };
  for (const id of Object.keys(next)) {
    if (!retained.has(id)) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : messages;
}

/**
 * Cheap "is the next snapshot structurally identical to what's already
 * stored?" check used by `setThread` to skip redundant rewrites.
 *
 * The earlier implementation ran `JSON.stringify` per message on every
 * call, which dominated the main thread on cold open of a long thread
 * (each fetch resolve, every WS-driven force refetch, and every
 * post-stream re-fetch funneled through this path). History rows are
 * append-only on the server, so matching the id sequence + the trailing
 * event's payload is sufficient: if the tail is structurally equal and
 * the count + ordering match, every prior row is also unchanged. False
 * positives only arise if the server mutates a non-tail row without
 * bumping the surrounding window; the next forced refetch sees
 * `lastMessageAt` move and rewrites anyway.
 */
function displayMessagesEqual(
  currentMessages: Record<string, DisplaySessionEvent>,
  currentIds: string[] | undefined,
  nextMessages: DisplaySessionEvent[],
): boolean {
  if (!currentIds || currentIds.length !== nextMessages.length) {
    return false;
  }
  for (let index = 0; index < nextMessages.length; index += 1) {
    if (currentIds[index] !== nextMessages[index].id) {
      return false;
    }
  }
  if (nextMessages.length === 0) return true;
  const tail = nextMessages[nextMessages.length - 1];
  const cachedTail = currentMessages[tail.id];
  if (!cachedTail) return false;
  if (cachedTail === tail) return true;
  return (
    cachedTail.role === tail.role &&
    cachedTail.content === tail.content &&
    cachedTail.thinkingText === tail.thinkingText &&
    cachedTail.inFlight === tail.inFlight
  );
}

export const useMessageStore = create<MessageStoreState>()((set, get) => ({
  messages: {},
  orderedIds: {},

  insertMessages: (threadKey, msgs) => {
    if (msgs.length === 0) return;
    set((s) => {
      const existingIds = s.orderedIds[threadKey] ?? [];
      const existingSet = new Set(existingIds);
      const newMessages = { ...s.messages };
      const newIds = [...existingIds];

      for (const msg of msgs) {
        newMessages[msg.id] = msg;
        if (!existingSet.has(msg.id)) {
          newIds.push(msg.id);
          existingSet.add(msg.id);
        }
      }

      return {
        messages: dropUnreferencedMessages(newMessages, {
          ...s.orderedIds,
          [threadKey]: trimThreadIds(newIds),
        }),
        orderedIds: { ...s.orderedIds, [threadKey]: trimThreadIds(newIds) },
      };
    });
  },

  prependMessages: (threadKey, msgs) => {
    if (msgs.length === 0) return;
    set((s) => {
      const existingIds = s.orderedIds[threadKey] ?? [];
      const existingSet = new Set(existingIds);
      const newMessages = { ...s.messages };
      const prependedIds: string[] = [];

      for (const msg of msgs) {
        newMessages[msg.id] = msg;
        if (!existingSet.has(msg.id)) {
          prependedIds.push(msg.id);
        }
      }

      const nextIds = trimThreadIds([...prependedIds, ...existingIds]);
      const nextOrderedIds = {
        ...s.orderedIds,
        [threadKey]: nextIds,
      };
      return {
        messages: dropUnreferencedMessages(newMessages, nextOrderedIds),
        orderedIds: nextOrderedIds,
      };
    });
  },

  appendMessage: (threadKey, msg) => {
    set((s) => {
      const existingIds = s.orderedIds[threadKey] ?? [];
      if (existingIds.includes(msg.id)) {
        return {
          messages: { ...s.messages, [msg.id]: msg },
          orderedIds: s.orderedIds,
        };
      }
      const nextOrderedIds = {
        ...s.orderedIds,
        [threadKey]: trimThreadIds([...existingIds, msg.id]),
      };
      return {
        messages: dropUnreferencedMessages({ ...s.messages, [msg.id]: msg }, nextOrderedIds),
        orderedIds: nextOrderedIds,
      };
    });
  },

  setThread: (threadKey, msgs) => {
    set((s) => {
      if (displayMessagesEqual(s.messages, s.orderedIds[threadKey], msgs)) {
        return s;
      }

      const newMessages = { ...s.messages };
      const ids: string[] = [];

      for (const msg of msgs) {
        newMessages[msg.id] = msg;
        ids.push(msg.id);
      }

      const nextOrderedIds = { ...s.orderedIds, [threadKey]: trimThreadIds(ids) };
      return {
        messages: dropUnreferencedMessages(newMessages, nextOrderedIds),
        orderedIds: nextOrderedIds,
      };
    });
  },

  getThreadMessages: (threadKey) => {
    const { messages, orderedIds } = get();
    const ids = orderedIds[threadKey];
    if (!ids || ids.length === 0) return EMPTY_MESSAGES;

    const result: DisplaySessionEvent[] = [];
    for (const id of ids) {
      const msg = messages[id];
      if (msg) result.push(msg);
    }
    return result;
  },

  clearThread: (threadKey) => {
    set((s) => {
      const ids = s.orderedIds[threadKey];
      if (!ids) return s;

      const allThreadIds = new Set<string>();
      for (const [key, threadIds] of Object.entries(s.orderedIds)) {
        if (key === threadKey) continue;
        for (const id of threadIds) allThreadIds.add(id);
      }

      const newMessages = { ...s.messages };
      for (const id of ids) {
        if (!allThreadIds.has(id)) {
          delete newMessages[id];
        }
      }

      const newOrderedIds = { ...s.orderedIds };
      delete newOrderedIds[threadKey];

      return { messages: newMessages, orderedIds: newOrderedIds };
    });
  },
}));

/**
 * Reactive hook that returns ordered messages for a thread.
 * Only re-renders when the thread's message IDs or message contents change.
 */
export function useThreadMessages(threadKey: string): DisplaySessionEvent[] {
  return useMessageStore(
    useShallow((s) => {
      const ids = s.orderedIds[threadKey];
      if (!ids || ids.length === 0) return EMPTY_MESSAGES;
      const result: DisplaySessionEvent[] = [];
      for (const id of ids) {
        const msg = s.messages[id];
        if (msg) result.push(msg);
      }
      return result;
    }),
  );
}
