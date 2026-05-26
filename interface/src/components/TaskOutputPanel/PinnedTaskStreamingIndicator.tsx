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
  /**
   * Render the shimmer with a default `Cooking...` label even before any
   * stream delta arrives. Used by callers that want the indicator to
   * appear in lockstep with the loop's progress glyph (e.g. the moment
   * automation enters `starting` / `preparing` / `active`, before
   * `task_started` produces real stream events). When `false` (the
   * default), the historical behaviour is preserved: the indicator only
   * mounts once real streaming activity is in flight. Passing an empty
   * string `taskId` is valid in this mode — the stream hooks return
   * empty state and the component renders the static `Cooking...`
   * fallback.
   */
  forceShow?: boolean;
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
  forceShow = false,
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
  if (!nowStreaming && !forceShow) return null;

  const label = getStreamingPhaseLabel({
    streamingText,
    thinkingText,
    toolCalls,
    progressText,
    isWriting,
  });

  // When `forceShow` is on but no stream data has arrived yet, fall back
  // to the static `Cooking...` label so the shimmer is visible. Once
  // real stream activity lands, `getStreamingPhaseLabel` takes over and
  // swaps to `Thinking.../tool name/etc.` without remounting.
  return (
    <div className={className} aria-live="polite" data-testid="pinned-task-streaming-indicator">
      <CookingIndicator label={label ?? "Cooking..."} />
    </div>
  );
}
