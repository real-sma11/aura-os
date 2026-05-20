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
  /**
   * Server- or client-classified error string (already stripped
   * of the `(support_id=...)` suffix). Set only on synthesized
   * error events emitted by `handleStreamError`. Rendered inline
   * in the Support ID + Report Bug action row in `MessageBubble`,
   * truncated with the full text exposed via the `title`
   * tooltip. Kept separate from `content` so the partial
   * streaming buffer (any text the assistant produced before the
   * turn errored out) can render through `LLMOutput` while the
   * synthesized error string lives in the action row instead of
   * being concatenated into the bubble body.
   */
  errorMessage?: string;
  /**
   * Org-level `agents.agent_id` UUID of the agent that injected
   * this `user_message` on behalf of cross-agent communication
   * (rather than the human user typing into the box). `undefined`
   * on every regular human-typed turn and on assistant rows.
   *
   * Mirrors `SessionEvent.from_agent_id`; threaded through by
   * `buildDisplayEvents` so `MessageBubble` can render a small
   * "↩ from <agent name>" badge above user-role bubbles when
   * set. The agent name is resolved from `useAgentStore` with a
   * truncated-id fallback when the sender belongs to another org
   * the local store has never fetched.
   */
  fromAgentId?: string;
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

/**
 * Kind of generation an entry is currently driving. Used to gate the
 * cooking-indicator ETA countdown so the timer only renders for the
 * generation modes we have estimates for. `null` when no generation
 * is in flight on this entry.
 */
export type GenerationKind = "image" | "video" | "3d";

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
  /**
   * Stamp the generation lifecycle for the entry. Called from
   * `useAgentChatStream` when an image / 3D / video stream opens so
   * the cooking-indicator ETA hook can read the start wall-clock and
   * model id to drive a per-model fallback estimate. `model` may be
   * null when the caller doesn't know the model id (e.g. the chat
   * 3D pipeline's source-image step uses the default image model
   * implicitly).
   */
  setGenerationState: Dispatch<{
    startedAt: number;
    model: string | null;
    kind: GenerationKind;
  }>;
  /**
   * Update the latest server-reported `percent` for the active
   * generation. The ETA hook switches from the per-model fallback
   * to `elapsed * (100 - percent) / percent` once the first
   * meaningful value lands.
   */
  setGenerationPercent: Dispatch<number | null>;
  /**
   * Clear the generation lifecycle for the entry. Called on
   * `generation_completed` / `generation_error` and from
   * `finalizeStream` / `handleStreamError` so the countdown disappears
   * the moment the stream terminates.
   */
  clearGeneration: Dispatch<void>;
}
