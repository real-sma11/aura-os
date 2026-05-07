import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { MessageBubble } from "../MessageBubble";
import { StreamingBubble } from "../StreamingBubble";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";

import { useStreamStore } from "../../../../hooks/stream/store";
import { useImageScrollPin } from "../../../../shared/hooks/use-image-scroll-pin";

interface ChatMessageListProps {
  messages: DisplaySessionEvent[];
  streamKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  emptyState?: ReactNode;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasOlderMessages?: boolean;
  onInitialAnchorReady?: () => void;
  isAutoFollowing?: boolean;
  /** Returns a non-zero `performance.now()` timestamp once the user has
   * shown explicit upward scroll intent (wheel/touch/keyboard). When
   * non-zero, the tail-pin layout effect and `useImageScrollPin` both
   * suppress writes to `scrollTop` so the user's reading position is
   * preserved during streams and the post-stream image-pin window. */
  getUserUnpinnedAt?: () => number;
  density?: "desktop" | "mobile";
  /** Optional UNIX-ms deadline; while now < deadline, image-load
   * events re-pin the scroll container even if the user isn't strictly
   * auto-following yet. Used by `ChatPanel` to keep the cold-load
   * reveal anchored while attachments decode. */
  imagePinUntil?: number;
}

const EMPTY_TOOL_CALLS: NonNullable<
  ReturnType<typeof useStreamStore.getState>["entries"][string]
>["activeToolCalls"] = [];
const EMPTY_TIMELINE: NonNullable<
  ReturnType<typeof useStreamStore.getState>["entries"][string]
>["timeline"] = [];

/**
 * React-key strategy for chat bubbles.
 *
 * The naive `key={msg.id}` strategy unmounts the trailing assistant
 * bubble across the stream-placeholder -> persisted-id swap at end of
 * turn (id changes, key changes, full remount). Conversely, the older
 * "assistant-tail" position-based key kept that swap stable but caused
 * a fresh remount of the *previous* turn's assistant whenever the user
 * sent a new message: the prior assistant slid out of `visibleCount-1`,
 * its key flipped from "assistant-tail" -> `msg.id`, the bubble
 * unmounted/remounted, `useHighlightedHtml`/markdown/images all
 * re-initialised, and the user saw the bubble disappear for hundreds
 * of ms until the new mount finished its async work.
 *
 * `applyTailIdAliases` walks the previous and current visible-message
 * arrays from the tail backward, and for each pair with the same role
 * and content but a different id (the placeholder -> persisted swap)
 * adds an alias from the new id to whatever stable key was used last
 * render. The render then keys each bubble by
 * `aliasMap.get(msg.id) ?? msg.id`, which keeps the placeholder id as
 * the React identity for that slot across the swap while leaving every
 * other bubble keyed by its stable id - so a new user message at the
 * end never disturbs the prior assistant's reconciliation slot.
 */
function applyTailIdAliases(
  aliasMap: Map<string, string>,
  prev: readonly DisplaySessionEvent[],
  curr: readonly DisplaySessionEvent[],
): void {
  const limit = Math.min(prev.length, curr.length);
  for (let i = 0; i < limit; i += 1) {
    const prevMsg = prev[prev.length - 1 - i];
    const currMsg = curr[curr.length - 1 - i];
    if (prevMsg.id === currMsg.id) {
      continue;
    }
    if (prevMsg.role !== currMsg.role || prevMsg.content !== currMsg.content) {
      // First non-aligned pair from the tail terminates the walk —
      // anything earlier in the list is structurally a different turn
      // and aliasing across it would conflate unrelated bubbles.
      break;
    }
    const stableKey = aliasMap.get(prevMsg.id) ?? prevMsg.id;
    aliasMap.set(currMsg.id, stableKey);
  }
}

/**
 * Renders the full chat transcript in natural flex flow. Pin-to-bottom and
 * reading-position preservation when content above the viewport changes
 * size are handled by the browser via CSS `overflow-anchor: auto` on the
 * parent scroll container (see `ChatPanel.module.css`). This component only
 * needs to push scrollTop to the fresh bottom when the last item itself
 * grows (streaming tokens, a new message arriving while pinned) — a case
 * the native scroll-anchoring algorithm doesn't cover, since it only
 * compensates for size changes above the anchor.
 */
export function ChatMessageList({
  messages,
  streamKey,
  scrollRef,
  emptyState,
  onLoadOlder,
  isLoadingOlder,
  hasOlderMessages,
  onInitialAnchorReady,
  isAutoFollowing = true,
  getUserUnpinnedAt,
  density = "desktop",
  imagePinUntil,
}: ChatMessageListProps) {
  useImageScrollPin(scrollRef, {
    isAutoFollowing,
    initialRevealUntil: imagePinUntil,
    getUserUnpinnedAt,
  });
  const {
    isStreaming,
    isWriting,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    timeline,
    progressText,
  } = useStreamStore(
    useShallow((state) => ({
      isStreaming: state.entries[streamKey]?.isStreaming ?? false,
      isWriting: state.entries[streamKey]?.isWriting ?? false,
      streamingText: state.entries[streamKey]?.streamingText ?? "",
      thinkingText: state.entries[streamKey]?.thinkingText ?? "",
      thinkingDurationMs: state.entries[streamKey]?.thinkingDurationMs ?? null,
      activeToolCalls: state.entries[streamKey]?.activeToolCalls ?? EMPTY_TOOL_CALLS,
      timeline: state.entries[streamKey]?.timeline ?? EMPTY_TIMELINE,
      progressText: state.entries[streamKey]?.progressText ?? "",
    })),
  );

  const nowStreaming =
    isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;
  const liveAssistantBubbleHasText = !!streamingText || !!thinkingText;
  const visibleMessages =
    liveAssistantBubbleHasText &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant"
      ? messages.slice(0, -1)
      : messages;
  const prevStreamingRef = useRef(nowStreaming);
  const justFinalizedIdRef = useRef<string | null>(null);
  const idAliasRef = useRef<Map<string, string>>(new Map());
  const prevVisibleRef = useRef<DisplaySessionEvent[]>([]);
  const prevStreamKeyRef = useRef(streamKey);

  // Detect streaming -> not-streaming transition during render so the
  // MessageBubble for the just-finalized message mounts with its thinking /
  // activity rows expanded, matching the live assistant row it replaces. This
  // has to happen during render (not useEffect) because `initialThinkingExpanded`
  // is read once at MessageBubble mount — deferring to useEffect means the
  // bubble mounts collapsed for one frame and then can't be re-expanded.
  // React Compiler's "no refs during render" rule doesn't distinguish this
  // legitimate render-phase derivation from genuine misuse, so we disable it
  // narrowly for this block.
  /* eslint-disable react-hooks/refs */
  {
    const wasStreaming = prevStreamingRef.current;
    if (wasStreaming && !nowStreaming) {
      const lastMsg = messages[messages.length - 1];
      justFinalizedIdRef.current = lastMsg ? lastMsg.id : null;
    }
    prevStreamingRef.current = nowStreaming;
    // Reset alias bookkeeping when the panel switches to a different
    // chat. Aliases recorded for the previous stream's placeholder
    // ids are meaningless for a new conversation, and would otherwise
    // accumulate across the app's lifetime.
    if (prevStreamKeyRef.current !== streamKey) {
      idAliasRef.current = new Map();
      prevVisibleRef.current = [];
      prevStreamKeyRef.current = streamKey;
    }
    applyTailIdAliases(idAliasRef.current, prevVisibleRef.current, visibleMessages);
    prevVisibleRef.current = visibleMessages;
  }
  /* eslint-enable react-hooks/refs */

  const hasMessages =
    messages.length > 0 ||
    isStreaming ||
    streamingText ||
    thinkingText ||
    activeToolCalls.length > 0 ||
    timeline.length > 0;

  const initialLayoutReadyKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!hasMessages) {
      initialLayoutReadyKeyRef.current = null;
      return;
    }
    const initialLayoutReadyKey = `${streamKey}:ready`;
    if (initialLayoutReadyKeyRef.current === initialLayoutReadyKey) {
      return;
    }
    initialLayoutReadyKeyRef.current = initialLayoutReadyKey;
    onInitialAnchorReady?.();
  }, [hasMessages, onInitialAnchorReady, streamKey]);

  // Pin to bottom when the tail grows. CSS scroll anchoring handles content
  // growth *above* the in-view anchor; it does not compensate for growth
  // *at* the anchor itself, so we explicitly push scrollTop to scrollHeight
  // whenever the streaming bubble gains tokens, a new message arrives, or
  // a tool-row reveals content — but only while the user is actually pinned.
  // The `getUserUnpinnedAt` check is defense in depth against same-tick
  // races where the user's wheel/touch event fires after this layout effect
  // has already been scheduled but before `isAutoFollowing` re-renders.
  useLayoutEffect(() => {
    if (!hasMessages || !isAutoFollowing) return;
    if (getUserUnpinnedAt && getUserUnpinnedAt() > 0) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    hasMessages,
    isAutoFollowing,
    getUserUnpinnedAt,
    scrollRef,
    messages.length,
    streamingText,
    thinkingText,
    activeToolCalls.length,
    progressText,
  ]);

  if (!hasMessages) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {hasOlderMessages && (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
          {isLoadingOlder ? (
            <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading...</span>
          ) : (
            <button
              type="button"
              onClick={onLoadOlder}
              style={{
                background: "none",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                padding: "6px 16px",
                color: "var(--color-text-secondary)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Load older messages
            </button>
          )}
        </div>
      )}
      {visibleMessages.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: density === "mobile" ? 6 : 2,
            flexShrink: 0,
          }}
        >
          {/* eslint-disable-next-line react-hooks/refs -- reading justFinalizedIdRef.current and idAliasRef.current here is part of the intentional render-phase pattern documented above the transition detection */}
          {visibleMessages.map((msg, index) => (
            <div
              key={idAliasRef.current.get(msg.id) ?? msg.id}
              data-message-id={msg.id}
              style={{ display: "flex", width: "100%" }}
            >
              <MessageBubble
                message={msg}
                isStreaming={isStreaming && msg.id.startsWith("stream-")}
                initialThinkingExpanded={msg.id === justFinalizedIdRef.current}
                initialActivitiesExpanded={msg.id === justFinalizedIdRef.current}
              />
            </div>
          ))}
        </div>
      )}
      {nowStreaming && (
        <div>
          <StreamingBubble
            isStreaming={isStreaming}
            text={streamingText}
            toolCalls={activeToolCalls}
            thinkingText={thinkingText}
            thinkingDurationMs={thinkingDurationMs}
            timeline={timeline}
            progressText={progressText}
            isWriting={isWriting}
            showPhaseIndicator={false}
          />
        </div>
      )}
    </>
  );
}
