import { useEffect, useRef, useState } from "react";
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
  //
  // The lazy-initialised `useState` below is load-bearing:
  // `createSession()` writes to `usePublicChatStore`, which is a
  // side effect that does NOT belong inside `useMemo` (memo factories
  // must be pure, and Strict Mode invokes them twice in dev — the
  // previous `useMemo` here minted a duplicate empty chat row on
  // every commit). `useState`'s initializer runs exactly once per
  // component instance, so even repeated re-renders triggered by the
  // login modal opening, closing, or surfacing validation errors
  // never produce a second `createSession()` call. The companion
  // `?session=` preservation in `LoggedOutTitlebar` and
  // `LoginOverlay` keeps `requestedSessionId` populated across the
  // `/` ↔ `/login` round trip so even a full remount of this view
  // reuses the same id instead of forging a fresh one.
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

  const isEmpty = controller.messages.length === 0;

  return (
    <div className={styles.chatView}>
      {/*
        Decorative AURA visual loop pinned to the center of the
        chat panel as ambient atmosphere. Lives at z-index 0 with
        `pointer-events: none` so it cannot intercept clicks or
        steal accessibility focus from the chat content above; the
        scroller and input slot both bump to z-index 1 in CSS.
        `aria-hidden` keeps assistive tech out of the loop.
      */}
      <video
        className={styles.chatBackgroundVideo}
        src="/AURA_visual_loop.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />
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
