import type { Dispatch, SetStateAction, MutableRefObject } from "react";

/* ------------------------------------------------------------------ */
/*  Display types used across stream hooks and UI components           */
/* ------------------------------------------------------------------ */

export interface DisplayContentBlock {
  type: "text";
  text: string;
}

export interface DisplayImageBlock {
  type: "image";
  media_type: string;
  data: string;
  /** S3 URL. When set, use this instead of data:base64. */
  source_url?: string;
}

export type DisplayContentBlockUnion = DisplayContentBlock | DisplayImageBlock;

export interface ArtifactRef {
  kind: "task" | "spec";
  id: string;
  title: string;
}

export type TimelineItem =
  | { kind: "thinking"; id: string; text?: string }
  | { kind: "text"; content: string; id: string }
  | { kind: "tool"; toolCallId: string; id: string };

export interface DisplaySessionEvent {
  id: string;
  /**
   * Stable React identity for the bubble across the entire lifecycle:
   *   - First assigned when the message is first created (optimistic
   *     user, stream placeholder, or hydrated history row).
   *   - Preserved across `id` mutations such as the
   *     `stream-...` -> persisted `event_id` swap that
   *     `handleEventSaved` performs at end-of-turn.
   *
   * `ChatMessageList` keys on `clientId ?? id` so React reconciliation
   * does NOT unmount/remount the bubble when the persisted id arrives.
   * Replaces the old `applyTailIdAliases` walk that compensated for
   * the same race after the fact.
   */
  clientId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  displayVariant?:
    | "insufficientCreditsError"
    | "agentBusyError"
    | "harnessCapacityExhaustedError"
    | "streamDropped";
  toolCalls?: ToolCallEntry[];
  artifactRefs?: ArtifactRef[];
  contentBlocks?: DisplayContentBlockUnion[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
  /**
   * Mirrors `SessionEvent.in_flight`: `true` when the server is still
   * streaming this assistant turn. Drives mid-turn refresh recovery —
   * see `useChatHistorySync` (re-arms `streamingAgentInstanceId`) and
   * `useChatStream` (skips `clearGeneratedArtifacts` so sidekick
   * pending placeholders survive the reload).
   */
  inFlight?: boolean;
  /**
   * Phase 5: the server-stamped `support_id` parsed out of an
   * `ErrorMsg.message` suffix (`(support_id=<12hex>)`). Set only
   * on synthesized error events emitted by `handleStreamError`;
   * surfaced as a copyable chip in the error bubble + as the
   * top-line context line in the `ReportBugButton` pre-fill so
   * support can join the chat-side report back to the matching
   * server `tracing` span.
   */
  supportId?: string;
}

export interface ToolCallEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  pending: boolean;
  started?: boolean;
  /**
   * `true` while the harness is between streaming-retry attempts for
   * this tool call. Set to `true` on every `ToolCallRetrying` event
   * from aura-harness and cleared back to `false` by the next
   * successful `ToolCallSnapshot` / `ToolResult`, or latched off by a
   * terminal `ToolCallFailed`. Renderers (see
   * `components/Block/renderers/FileBlock.tsx`) switch the card
   * title to "… retrying (n/max)…" while this is set.
   */
  retrying?: boolean;
  /** 1-indexed attempt number carried on the latest ToolCallRetrying. */
  retryAttempt?: number;
  /** Total retry budget for this tool call (harness default: 8). */
  retryMax?: number;
  /** Classified reason the last retry was scheduled for (e.g.
   *  "upstream_529_overloaded", "stream_aborted_mid_tool_use"). */
  retryReason?: string;
  /**
   * Set to `true` when aura-harness emits `ToolCallFailed` for this
   * `tool_use_id` *and* the server-side
   * `TOOL_CALL_RETRY_BUDGET` has also been exhausted — i.e. both
   * retry ladders gave up. Used by renderers to prefix the failure
   * title with "retried N/max — " so users understand the full
   * recovery history, not just the last stream abort.
   */
  retryExhausted?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Ref / setter interfaces for stream state                           */
/* ------------------------------------------------------------------ */

export interface StreamRefs {
  streamBuffer: MutableRefObject<string>;
  thinkingBuffer: MutableRefObject<string>;
  thinkingStart: MutableRefObject<number | null>;
  toolCalls: MutableRefObject<ToolCallEntry[]>;
  raf: MutableRefObject<number | null>;
  flushTimeout: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  displayedTextLength: MutableRefObject<number>;
  lastTextFlushAt: MutableRefObject<number>;
  thinkingRaf: MutableRefObject<number | null>;
  timeline: MutableRefObject<TimelineItem[]>;
  snapshottedToolCallIds: MutableRefObject<Set<string>>;
}

export interface StreamSetters {
  setStreamingText: Dispatch<SetStateAction<string>>;
  setThinkingText: Dispatch<SetStateAction<string>>;
  setThinkingDurationMs: Dispatch<SetStateAction<number | null>>;
  setActiveToolCalls: Dispatch<SetStateAction<ToolCallEntry[]>>;
  setEvents: Dispatch<SetStateAction<DisplaySessionEvent[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setIsWriting: Dispatch<SetStateAction<boolean>>;
  setProgressText: Dispatch<SetStateAction<string>>;
  setTimeline: Dispatch<SetStateAction<TimelineItem[]>>;
}
