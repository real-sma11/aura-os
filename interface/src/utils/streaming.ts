import type { ToolCallEntry } from "../shared/types/stream";
import { TOOL_PHASE_LABELS } from "../constants/tools";

const CONNECTING_LABELS = [
  "Syncing",
  "Wiring",
  "Connecting",
  "Routing",
  "Relating",
  "Integrating",
] as const;

let _cachedConnectingLabel: string | null = null;

function pickConnectingLabel(): string {
  if (!_cachedConnectingLabel) {
    _cachedConnectingLabel =
      CONNECTING_LABELS[Math.floor(Math.random() * CONNECTING_LABELS.length)];
  }
  return _cachedConnectingLabel;
}

export function getStreamingPhaseLabel(state: {
  thinkingText?: string;
  streamingText: string;
  toolCalls: ToolCallEntry[];
  progressText?: string;
  /**
   * Accepted for backwards-compat with callers that still forward the
   * stream entry's `isWriting` flag, but intentionally unused: the
   * pinned cooking shimmer must stay visible for the entire active
   * turn rather than oscillate on every word-reveal step. Visibility
   * is gated upstream by `nowStreaming` in the indicator components.
   */
  isWriting?: boolean;
}): string | null {
  const realToolCalls = state.toolCalls.filter((tc) => !tc.synthetic);
  const pending = realToolCalls.find((tc) => tc.pending);
  if (pending) return TOOL_PHASE_LABELS[pending.name] ?? "Working...";
  if (state.thinkingText && !state.streamingText) return "Thinking...";
  if (realToolCalls.length > 0) return "Putting it all together...";
  if (state.progressText) {
    if (state.progressText.toLowerCase() === "connecting") {
      return pickConnectingLabel();
    }
    if (state.progressText.toLowerCase() === "queued") {
      return "Queued...";
    }
    return state.progressText;
  }
  _cachedConnectingLabel = null;
  return "Cooking...";
}
