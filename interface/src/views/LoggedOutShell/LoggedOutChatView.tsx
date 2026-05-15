import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DesktopChatInputBar } from "../../features/chat-ui/ChatInputBar";
import { ChatMessageList } from "../../features/chat-ui/ChatMessageList";
import { KeepChattingModal } from "../../components/KeepChattingModal";
import { ComposePanel } from "./ComposePanel";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { usePublicChat } from "./use-public-chat";
import styles from "./LoggedOutShell.module.css";

/**
 * Right-side chat surface for the logged-out shell. Mounts the
 * promoted `features/chat-ui/ChatInputBar` (so logged-out and
 * authenticated visitors see an identical compose experience) and
 * `features/chat-ui/ChatMessageList`. Everything stateful is
 * delegated to `usePublicChat`; this file is the presentational shell.
 *
 * Empty-state UX: instead of a passive heading + bottom input bar,
 * the empty transcript renders a centered `ComposePanel` inline in
 * the main panel (heading + input bar + mode-pill widgets). Once the
 * first message lands, the view flips to the standard inline-
 * transcript layout with the input bar anchored at the bottom.
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

  const isEmpty = controller.messages.length === 0;

  return (
    <div className={styles.chatView}>
      <div className={styles.chatScroller} ref={scrollRef}>
        {isEmpty ? (
          <div className={styles.chatEmpty}>
            <ComposePanel
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
        ) : (
          <ChatMessageList
            messages={controller.messages}
            streamKey={controller.streamKey}
            scrollRef={scrollRef}
          />
        )}
      </div>
      {!isEmpty && (
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
      )}
      {controller.shouldShowGate && <KeepChattingModal />}
    </div>
  );
}
