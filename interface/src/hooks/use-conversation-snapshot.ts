import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStreamEvents } from "./stream/hooks";
import { useStreamStore } from "./stream/store";
import { useMessageStore } from "../stores/message-store";
import { projectConversation } from "../shared/lib/conversation-projector";
import type { DisplaySessionEvent } from "../shared/types/stream";

interface UseConversationSnapshotOptions {
  streamKey: string;
  transcriptKey: string;
  historyMessages?: DisplaySessionEvent[];
}

/**
 * Single-frame projection of the chat transcript from the three input
 * stores (history snapshot, message-store thread, live stream events)
 * into the canonical ordered `messages` array consumed by `ChatPanel`.
 *
 * Phase A of the data-layer refactor reduced this from a 200-line merge
 * with anchor rules + a `reinstateMissingPersistedOnSend` backstop +
 * a `lastNonEmptyRef` empty-frame cache to a thin call into the pure
 * `projectConversation` projector. The hacks went away because the
 * upstream stream handlers now stamp every message with a stable
 * `clientId` (see `attachment-helpers.buildUserChatMessage` and
 * `stream/handlers/lifecycle.handleEventSaved`), so React keys stay
 * pinned across the placeholder -> persisted-id swap and the merge
 * never has to chase an inconsistent id.
 *
 * The `setThread` effect still bridges history into the message-store
 * (used by the older snapshot consumers) but no longer feeds the
 * projector's stored input — `historyMessages` is the canonical source.
 */
export function useConversationSnapshot({
  streamKey,
  transcriptKey,
  historyMessages,
}: UseConversationSnapshotOptions): { messages: DisplaySessionEvent[] } {
  useEffect(() => {
    if (historyMessages && historyMessages.length > 0) {
      useMessageStore.getState().setThread(transcriptKey, historyMessages);
    }
  }, [transcriptKey, historyMessages]);

  const streamMessages = useStreamEvents(streamKey);
  const liveAssistantHasContent = useStreamStore(
    useShallow((state) => {
      const entry = state.entries[streamKey];
      if (!entry) return false;
      return Boolean(entry.streamingText || entry.thinkingText) ||
        entry.activeToolCalls.length > 0 ||
        entry.timeline.length > 0 ||
        Boolean(entry.progressText);
    }),
  );

  const messages = useMemo(
    () => projectConversation(historyMessages ?? [], streamMessages, liveAssistantHasContent),
    [historyMessages, streamMessages, liveAssistantHasContent],
  );

  return { messages };
}
