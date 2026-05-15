import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DesktopChatInputBar } from "../../features/chat-ui/ChatInputBar";
import { ChatMessageList } from "../../features/chat-ui/ChatMessageList";
import { KeepChattingModal } from "../../components/KeepChattingModal";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { usePublicChat } from "./use-public-chat";
import styles from "./LoggedOutShell.module.css";

/**
 * Right-side chat surface for the logged-out shell. Mounts the
 * promoted `features/chat-ui/ChatInputBar` (so logged-out and
 * authenticated visitors see an identical compose experience) and
 * `features/chat-ui/ChatMessageList`. Everything stateful is
 * delegated to `usePublicChat`; this file is the presentational shell.
 */
export function LoggedOutChatView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const createSession = usePublicChatStore((s) => s.createSession);

  // Ensure the URL always carries a valid session id. If the visitor
  // lands on `/` we mint one and rewrite the URL so the rest of the
  // tree (input bar `streamKey`, sessions panel highlight) can rely
  // on a non-null `sessionId`.
  const sessionId = useMemo(() => {
    if (requestedSessionId) return requestedSessionId;
    return createSession();
  }, [requestedSessionId, createSession]);

  useEffect(() => {
    if (!requestedSessionId) {
      setSearchParams({ session: sessionId }, { replace: true });
    }
  }, [requestedSessionId, sessionId, setSearchParams]);

  const controller = usePublicChat(sessionId);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className={styles.chatView}>
      <div className={styles.chatScroller} ref={scrollRef}>
        {controller.messages.length === 0 ? (
          <div className={styles.chatEmpty}>
            <div className={styles.chatEmptyHeading}>What can I help with?</div>
            <div>Pick a mode and start chatting — Code or Plan supported.</div>
          </div>
        ) : (
          <ChatMessageList
            messages={controller.messages}
            streamKey={controller.streamKey}
            scrollRef={scrollRef}
          />
        )}
      </div>
      {controller.comingSoonMessage && (
        <div className={styles.comingSoon}>
          <span>{controller.comingSoonMessage}</span>
          <button
            type="button"
            className={styles.comingSoonDismiss}
            onClick={controller.dismissComingSoon}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <div
        className={`${styles.inputBarSlot} ${
          controller.shouldShowGate ? styles.inputBarSlotLocked : ""
        }`}
        aria-disabled={controller.shouldShowGate ? "true" : undefined}
      >
        <DesktopChatInputBar
          input={controller.input}
          onInputChange={controller.setInput}
          onSend={(content) => {
            void controller.handleSend(content);
          }}
          onStop={controller.handleStop}
          streamKey={controller.streamKey}
          agentId={controller.agentId}
          defaultModel={controller.defaultModel}
        />
      </div>
      {controller.shouldShowGate && <KeepChattingModal />}
    </div>
  );
}
