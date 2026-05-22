import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ImagePlus, X } from "lucide-react";
import { DesktopChatInputBar } from "../../../features/chat-ui/ChatInputBar";
import { ChatMessageList } from "../../../features/chat-ui/ChatMessageList";
import { ChatStreamingIndicator } from "../../../features/chat-ui/ChatPanel/ChatStreamingIndicator";
import { KeepChattingModal } from "../../../components/KeepChattingModal";
import { ComposePanel } from "../ComposePanel";
import { usePublicChatStore } from "../../../stores/public-chat-store";
import { useChatUI } from "../../../stores/chat-ui-store";
import { usePublicChat } from "../use-public-chat";
import styles from "./PublicChatView.module.css";

/**
 * Right-side chat surface for the public (logged-out) shell. Mounts
 * the promoted `features/chat-ui/ChatInputBar` (so logged-out and
 * authenticated visitors see an identical compose experience) and
 * `features/chat-ui/ChatMessageList`. Everything stateful is
 * delegated to `usePublicChat`; this file is the presentational shell.
 *
 * Empty-state UX: instead of a passive heading + bottom input bar,
 * the empty transcript renders a centered `ComposePanel` inline in
 * the main panel (heading + input bar + mode-pill widgets). Once the
 * first message lands, the view flips to the standard inline-
 * transcript layout with the input bar anchored at the bottom.
 *
 * Phase 4 product rule: this component (and the `AgentDemoBanner` /
 * `ComposePanel` / `LoginOverlay` it transitively mounts) is the
 * **public-only** chat surface. It is NOT reachable from any authed
 * render path — the `ChatRouteSwitch` in `App.tsx` only mounts it
 * when `effectiveMode === "public"`.
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const streamKey = controller.streamKey;
  const selectedMode = useChatUI(streamKey).selectedMode;
  const is3dMode = selectedMode === "3d";

  const handleImagePick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        controller.setSourceImage(reader.result as string);
        if (!controller.input.trim()) {
          controller.setInput("Generate 3D model");
        }
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [controller.input, controller.setInput, controller.setSourceImage],
  );

  const isEmpty = controller.messages.length === 0;

  const imageAttachBar = is3dMode && !controller.shouldShowGate ? (
    <div className={styles.imageAttachBar}>
      {controller.sourceImage ? (
        <div className={styles.imageAttachPreview}>
          <img
            src={controller.sourceImage}
            alt="Source for 3D"
            className={styles.imageAttachThumb}
          />
          <button
            type="button"
            className={styles.imageAttachRemove}
            onClick={() => controller.setSourceImage(null)}
            aria-label="Remove image"
          >
            <X size={12} />
          </button>
          <span className={styles.imageAttachLabel}>Source image attached</span>
        </div>
      ) : (
        <button
          type="button"
          className={styles.imageAttachButton}
          onClick={handleImagePick}
        >
          <ImagePlus size={14} />
          <span>Attach source image for 3D</span>
        </button>
      )}
    </div>
  ) : null;

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
        <ChatStreamingIndicator
          streamKey={controller.streamKey}
          onStop={controller.handleStop}
        />
      )}
      {imageAttachBar}
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
      {/* Hidden file input for 3D source image */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: "none" }}
        aria-hidden="true"
      />
      {controller.shouldShowGate && <KeepChattingModal />}
    </div>
  );
}
