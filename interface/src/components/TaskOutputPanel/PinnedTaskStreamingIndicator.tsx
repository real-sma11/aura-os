import { useTaskStream } from "../../hooks/use-task-stream";
import {
  useIsStreaming,
  useIsWriting,
  useStreamingText,
  useThinkingText,
  useActiveToolCalls,
  useProgressText,
} from "../../hooks/stream/hooks";
import { getStreamingPhaseLabel } from "../../utils/streaming";
import { CookingIndicator } from "../CookingIndicator";

interface PinnedTaskStreamingIndicatorProps {
  taskId: string;
  /**
   * Caller-supplied class for the absolute/sticky wrapper. The Run pane
   * passes `styles.pinnedStreamingIndicator` (position: absolute, fixed
   * to the bottom of `.contentShell`); `TaskPreview` passes
   * `previewStyles.previewStreamingIndicator` (position: sticky on the
   * scrolling preview body). The component itself is layout-agnostic so
   * both surfaces can share the streaming-state + label logic without
   * duplicating the hook chain.
   */
  className?: string;
}

/**
 * Pinned cooking indicator for a single active task.
 *
 * Reads the live stream state via the same hook chain the Run pane's
 * inlined version used, computes the current phase label via
 * `getStreamingPhaseLabel`, and renders `<CookingIndicator>` inside a
 * wrapper styled by the caller. Returns `null` when no streaming
 * activity is in flight so callers can mount it unconditionally
 * without an extra `isActive` check (though `TaskPreview` still gates
 * on `isActive` upstream to avoid mounting the hook chain on terminal
 * rows).
 *
 * Extracted from `TaskOutputPanel.tsx` so `TaskPreview` can re-use the
 * exact same indicator pinned to its scrolling preview body via the
 * orphaned `.previewStreamingIndicator` rule in
 * `Preview/Preview.module.css`. Without this, the Tasks-tab preview
 * lost its pinned cooking shimmer in commit `c03e3114a` when
 * `TaskOutputSection` was swapped for `ActiveTaskStream`.
 */
export function PinnedTaskStreamingIndicator({
  taskId,
  className,
}: PinnedTaskStreamingIndicatorProps) {
  const { streamKey } = useTaskStream(taskId, true);
  const isStreaming = useIsStreaming(streamKey);
  const isWriting = useIsWriting(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const toolCalls = useActiveToolCalls(streamKey);
  const progressText = useProgressText(streamKey);

  const nowStreaming =
    isStreaming || !!streamingText || !!thinkingText || toolCalls.length > 0;
  if (!nowStreaming) return null;

  const label = getStreamingPhaseLabel({
    streamingText,
    thinkingText,
    toolCalls,
    progressText,
    isWriting,
  });

  return (
    <div className={className} aria-live="polite" data-testid="pinned-task-streaming-indicator">
      <CookingIndicator label={label ?? "Cooking..."} hidden={!label} />
    </div>
  );
}
