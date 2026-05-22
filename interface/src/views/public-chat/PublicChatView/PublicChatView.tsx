import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChatMessageList } from "../../../features/chat-ui/ChatMessageList";
import { ChatStreamingIndicator } from "../../../features/chat-ui/ChatPanel/ChatStreamingIndicator";
import { KeepChattingModal } from "../../../components/KeepChattingModal";
import { ComposePanel } from "../ComposePanel";
import {
  PublicComposeInput,
  type PublicComposeInputHandle,
} from "../PublicComposeInput";
import { usePublicChatStore } from "../../../stores/public-chat-store";
import { usePublicChat } from "../use-public-chat";
import styles from "./PublicChatView.module.css";

/**
 * Right-side chat surface for the public (logged-out) shell. Mounts
 * the dedicated `PublicComposeInput` (a stripped-down pill-shaped
 * compose input) and the shared `ChatMessageList`. Everything stateful
 * is delegated to `usePublicChat`; this file is the presentational
 * shell.
 *
 * Empty-state UX: the `PublicComposeInput` is mounted in the
 * bottom-anchored `.inputBarSlot` in BOTH empty and populated
 * states, so the rounded input pill never moves vertically when the
 * visitor sends their first message. The empty-state `ComposePanel`
 * mounts the windowed `MockAuraApp` hero (which carries its own
 * wallpaper video, scripted DM windows, and the example-prompt
 * pills inside the mock app's `inputDock` slot) above that fixed
 * input bar. Once the first message lands the view swaps the
 * empty-state hero for the transcript and leaves the input bar
 * exactly where it was.
 *
 * Phase 5 (this file's split from the legacy authenticated input):
 * the public input is now a separate, much simpler component than
 * the authenticated `DesktopChatInputBar`. The public dispatch path
 * does not consume mode pickers, model pickers, slash commands,
 * project chips, or attachments today, so dragging that chrome onto
 * the logged-out surface only added visual weight. The stripped
 * input here owns just `+`, textarea, and send/stop affordances.
 */
export function PublicChatView(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const createSession = usePublicChatStore((s) => s.createSession);

  const [autoCreatedId] = useState<string | null>(() =>
    requestedSessionId ? null : createSession(),
  );
  const sessionId = requestedSessionId ?? autoCreatedId!;

  useEffect(() => {
    if (!requestedSessionId) {
      setSearchParams({ session: sessionId }, { replace: true });
    }
  }, [requestedSessionId, sessionId, setSearchParams]);

  const controller = usePublicChat(sessionId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputBarRef = useRef<PublicComposeInputHandle>(null);

  const handleSelectExample = useCallback(
    (prompt: string) => {
      controller.setInput(prompt);
      inputBarRef.current?.focus();
    },
    [controller.setInput],
  );

  const isEmpty = controller.messages.length === 0;

  return (
    <div className={styles.chatView}>
      <div className={styles.chatScroller} ref={scrollRef}>
        {isEmpty ? (
          <div className={styles.chatEmpty}>
            <ComposePanel onSelectExample={handleSelectExample} />
          </div>
        ) : (
          <ChatMessageList
            messages={controller.messages}
            streamKey={controller.streamKey}
            scrollRef={scrollRef}
          />
        )}
      </div>
      {!isEmpty && (
        <ChatStreamingIndicator
          streamKey={controller.streamKey}
          onStop={controller.handleStop}
        />
      )}
      {/*
        The compose input lives in the floating `.inputBarSlot` in
        both empty and populated states so the rounded input pill
        stays pinned to the bottom of the screen at the same
        position regardless of whether the visitor has sent a
        message yet.
      */}
      <div
        className={`${styles.inputBarSlot} ${
          controller.shouldShowGate ? styles.inputBarSlotLocked : ""
        }`}
        aria-disabled={controller.shouldShowGate ? "true" : undefined}
      >
        <PublicComposeInput
          ref={inputBarRef}
          input={controller.input}
          onInputChange={controller.setInput}
          onSend={(content) => {
            void controller.handleSend(content);
          }}
          onStop={controller.handleStop}
          isStreaming={controller.isStreaming}
          disabled={controller.shouldShowGate}
        />
      </div>
      {controller.shouldShowGate && <KeepChattingModal />}
    </div>
  );
}
