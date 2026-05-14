import { useShallow } from "zustand/react/shallow";
import { CookingIndicator } from "../../../../components/CookingIndicator";
import { StuckStreamPill } from "../../../../components/StuckStreamPill";
import { useStreamStore } from "../../../../hooks/stream/store";
import { useStreamHealth } from "../../../../hooks/stream/use-stream-health";
import { getStreamingPhaseLabel } from "../../../../utils/streaming";
import type { ToolCallEntry } from "../../../../shared/types/stream";
import styles from "./ChatPanel.module.css";

const EMPTY_TOOL_CALLS: ToolCallEntry[] = [];

interface ChatStreamingIndicatorProps {
  streamKey: string;
  /**
   * Stops the in-flight stream when the Phase 2 stuck-stream pill's
   * Stop button is clicked. Falls back to a no-op when the parent
   * panel has not yet wired the callback (the cooking-indicator path
   * doesn't need it, so it stays optional for backwards compat).
   */
  onStop?: () => void;
  /**
   * Replays the most recent user message. Composed by `ChatPanel`
   * against the `lastSendArgs` cache; see Phase 2 wiring in
   * `use-agent-chat-stream` and `partition-send-control`.
   */
  onRetry?: () => void;
  /**
   * Phase 2 -> Phase 5: when set, falls back to this legacy
   * callback as the pill's Report action. Phase 5 wiring renders
   * an inline `ReportBugButton` instead (because `streamKey` is
   * always present), so this prop is kept only so Phase-2
   * standalone tests still compile.
   */
  onReport?: () => void;
}

/**
 * Pins the streaming phase indicator ("Cooking...", "Thinking...", etc.)
 * absolutely over the empty zone above the input bar so that phase
 * transitions never reflow the chat content. The inline indicator inside
 * `StreamingBubble` is suppressed in this chat context via
 * `showPhaseIndicator={false}`.
 *
 * Phase 2: when the SSE wire has gone silent past `STUCK_THRESHOLD_MS`
 * the pinned slot swaps from `<CookingIndicator />` to a
 * `<StuckStreamPill />` with explicit Stop / Retry / Report actions
 * so the user has an escape hatch instead of staring at a stale
 * "Cooking..." for minutes.
 */
export function ChatStreamingIndicator({
  streamKey,
  onStop,
  onRetry,
  onReport,
}: ChatStreamingIndicatorProps) {
  const { isStreaming, streamingText, thinkingText, toolCalls, progressText } = useStreamStore(
    useShallow((state) => ({
      isStreaming: state.entries[streamKey]?.isStreaming ?? false,
      streamingText: state.entries[streamKey]?.streamingText ?? "",
      thinkingText: state.entries[streamKey]?.thinkingText ?? "",
      toolCalls: state.entries[streamKey]?.activeToolCalls ?? EMPTY_TOOL_CALLS,
      progressText: state.entries[streamKey]?.progressText ?? "",
    })),
  );
  const health = useStreamHealth(streamKey);

  const nowStreaming =
    isStreaming || !!streamingText || !!thinkingText || toolCalls.length > 0;

  if (!nowStreaming) {
    return null;
  }

  if (health.isStuck) {
    return (
      <div className={styles.pinnedStreamingIndicator}>
        <div className={styles.pinnedStreamingIndicatorInner}>
          <StuckStreamPill
            stuckForMs={health.stuckForMs}
            streamKey={streamKey}
            onStop={onStop ?? (() => {})}
            onRetry={onRetry ?? (() => {})}
            onReport={onReport}
          />
        </div>
      </div>
    );
  }

  const label = getStreamingPhaseLabel({
    streamingText,
    thinkingText,
    toolCalls,
    progressText,
  });

  return (
    <div className={styles.pinnedStreamingIndicator} aria-live="polite">
      <div className={styles.pinnedStreamingIndicatorInner}>
        <CookingIndicator label={label ?? "Cooking..."} />
      </div>
    </div>
  );
}
