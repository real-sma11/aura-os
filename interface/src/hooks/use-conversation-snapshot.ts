import { useEffect, useMemo } from "react";
import { useStreamEvents } from "./stream/hooks";
import { useMessageStore } from "../stores/message-store";
import { projectConversation } from "../shared/lib/conversation-projector";
import type { DisplaySessionEvent } from "../shared/types/stream";

interface UseConversationSnapshotOptions {
  streamKey: string;
  transcriptKey: string;
  historyMessages?: DisplaySessionEvent[];
}

/**
 * Single-frame projection of the chat transcript from the persisted
 * history snapshot and the live stream events into the canonical
 * ordered `messages` array consumed by `ChatPanel`/`ChatMessageList`.
 *
 * Phase B of the bottoms-up refactor reduced this from a 525-line merge
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
 * for the older snapshot consumers (`use-load-older-messages`,
 * `useOnboardingTaskWatcher`); the projector itself has no dependency
 * on the message-store and reads `historyMessages` directly.
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

  const messages = useMemo(
    () => projectConversation(historyMessages ?? [], streamMessages),
    [historyMessages, streamMessages],
  );

  return { messages };
}
