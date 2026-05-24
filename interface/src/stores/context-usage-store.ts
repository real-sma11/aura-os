import { create } from "zustand";

/**
 * Per-bucket context-window token estimates emitted by the harness in
 * `AssistantMessageEnd.usage.context_breakdown`. The frontend keeps
 * these on the store so the bottom-bar Context popover can render the
 * stacked-bar / category breakdown.
 *
 * `mcpTokens` is reserved (always 0 today) for future MCP support; the
 * popover hides it until it goes positive so existing layouts stay
 * stable.
 */
export interface ContextBreakdown {
  systemPromptTokens: number;
  toolsTokens: number;
  skillsTokens: number;
  mcpTokens: number;
  subagentsTokens: number;
  conversationTokens: number;
  /**
   * Tokens that came from the upstream provider's prompt cache during
   * the most recent turn. Surfaced as "Cached this turn" in the
   * popover; not a separate context bucket (so excluded from the
   * stacked bar and from `isBreakdownEmpty`).
   */
  cacheReadTokens: number;
  /**
   * Tokens written to the upstream provider's prompt cache during the
   * most recent turn. Paired with `cacheReadTokens` to show
   * read-vs-write at a glance.
   */
  cacheCreationTokens: number;
}

/**
 * Wire shape of the harness's `usage.context_breakdown` payload on
 * `AssistantMessageEnd`. Mirrors the snake_case fields in
 * `crates/aura-protocol/src/server.rs::ContextBreakdown` and
 * `interface/src/shared/types/harness-protocol.ts::ContextBreakdown`.
 * Every field is optional because older harness builds omit them
 * individually and the camelCase mapper below treats missing fields
 * as 0.
 */
export interface WireContextBreakdown {
  system_prompt_tokens?: number;
  tools_tokens?: number;
  skills_tokens?: number;
  mcp_tokens?: number;
  subagents_tokens?: number;
  conversation_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}

/**
 * Map the harness's snake_case `context_breakdown` payload into the
 * store's camelCase `ContextBreakdown` shape. Returns `undefined`
 * when the input itself is missing; callers can pass the result
 * straight to `setContextUtilization`, which additionally drops
 * all-zero payloads via its internal `isBreakdownEmpty` filter so
 * older harness builds keep falling back to the legacy popover.
 */
export function mapWireContextBreakdown(
  cb: WireContextBreakdown | undefined,
): ContextBreakdown | undefined {
  if (!cb) return undefined;
  return {
    systemPromptTokens: cb.system_prompt_tokens ?? 0,
    toolsTokens: cb.tools_tokens ?? 0,
    skillsTokens: cb.skills_tokens ?? 0,
    mcpTokens: cb.mcp_tokens ?? 0,
    subagentsTokens: cb.subagents_tokens ?? 0,
    conversationTokens: cb.conversation_tokens ?? 0,
    cacheReadTokens: cb.cache_read_tokens ?? 0,
    cacheCreationTokens: cb.cache_creation_tokens ?? 0,
  };
}

export interface ContextUsageEntry {
  utilization: number;
  estimatedTokens?: number;
  breakdown?: ContextBreakdown;
}

interface ContextUsageState {
  usageByStreamKey: Record<string, ContextUsageEntry>;
  /**
   * Cached utilization-per-token ratio derived from the last authoritative
   * `AssistantMessageEnd` payload. Used to project live utilization from
   * streaming token deltas so the Context pill updates mid-turn instead
   * of jumping only at turn boundaries.
   */
  utilPerTokenByStreamKey: Record<string, number>;
  /**
   * Per-streamKey "reset pending" sentinel. Set by {@link markResetPending}
   * when the user clicks "New session". While `true`, hydration hooks MUST
   * skip seeding the store from server-side session data so a stale latest
   * session (e.g. the reset API call failed, or storage hasn't yet surfaced
   * the freshly-created empty session) doesn't resurrect the old value.
   *
   * The sentinel clears automatically on the next `setContextUtilization`
   * call for that stream key, which happens when the first
   * `AssistantMessageEnd` of the new session arrives from the harness.
   */
  resetPendingByStreamKey: Record<string, true>;
  setContextUtilization: (
    key: string,
    utilization: number,
    estimatedTokens?: number,
    breakdown?: ContextBreakdown,
  ) => void;
  /**
   * Optimistically bump the estimated token count for a stream by
   * `tokensDelta`. Projects `utilization` from the cached per-token ratio
   * when available so the UI moves during a live turn. The next
   * `setContextUtilization` call reconciles the optimistic value with the
   * server-reported authoritative one.
   *
   * Also nudges `breakdown.conversationTokens` upward by the same
   * delta so the stacked-bar popover stays alive between authoritative
   * refreshes — only the conversation bucket grows mid-turn; the
   * static buckets (system prompt / tools / skills / subagents)
   * cannot change between turns.
   */
  bumpEstimatedTokens: (key: string, tokensDelta: number) => void;
  clearContextUtilization: (key: string) => void;
  markResetPending: (key: string) => void;
  isResetPending: (key: string) => boolean;
}

/** True when every bucket is zero — treated by the UI as "not available". */
function isBreakdownEmpty(b: ContextBreakdown | undefined): boolean {
  if (!b) return true;
  return (
    b.systemPromptTokens === 0 &&
    b.toolsTokens === 0 &&
    b.skillsTokens === 0 &&
    b.mcpTokens === 0 &&
    b.subagentsTokens === 0 &&
    b.conversationTokens === 0
  );
}

export const useContextUsageStore = create<ContextUsageState>((set, get) => ({
  usageByStreamKey: {},
  utilPerTokenByStreamKey: {},
  resetPendingByStreamKey: {},
  setContextUtilization: (key, utilization, estimatedTokens, breakdown) =>
    set((state) => {
      const { [key]: _, ...resetRest } = state.resetPendingByStreamKey;
      const entry: ContextUsageEntry = { utilization };
      let nextRatios = state.utilPerTokenByStreamKey;
      if (
        typeof estimatedTokens === "number" &&
        Number.isFinite(estimatedTokens) &&
        estimatedTokens >= 0
      ) {
        entry.estimatedTokens = estimatedTokens;
        if (estimatedTokens > 0 && utilization > 0) {
          nextRatios = {
            ...state.utilPerTokenByStreamKey,
            [key]: utilization / estimatedTokens,
          };
        }
      }
      // Drop the breakdown when every bucket is zero — that's the
      // "older harness, didn't emit it" sentinel and the UI's fallback
      // path keys off `breakdown == null`.
      if (!isBreakdownEmpty(breakdown)) {
        entry.breakdown = breakdown;
      }
      return {
        usageByStreamKey: { ...state.usageByStreamKey, [key]: entry },
        utilPerTokenByStreamKey: nextRatios,
        resetPendingByStreamKey: resetRest,
      };
    }),
  bumpEstimatedTokens: (key, tokensDelta) => {
    if (!Number.isFinite(tokensDelta) || tokensDelta <= 0) return;
    set((state) => {
      const prev = state.usageByStreamKey[key];
      const ratio = state.utilPerTokenByStreamKey[key];
      const prevTokens = prev?.estimatedTokens ?? 0;
      const nextTokens = prevTokens + tokensDelta;
      const prevUtil = prev?.utilization ?? 0;
      const projectedUtil = ratio ? Math.min(1, nextTokens * ratio) : prevUtil;
      // Only advance forward so we don't undo a larger authoritative
      // value that might have landed between deltas.
      const nextUtil = Math.max(prevUtil, projectedUtil);
      // Mid-turn growth is conversation-only — system prompt, tools,
      // skills, and subagent registry can't change between turns. If a
      // breakdown has been seeded by an authoritative `AssistantMessageEnd`,
      // grow the conversation bucket so the popover bar tracks the live
      // turn instead of freezing at the last reconciled value.
      const nextBreakdown = prev?.breakdown
        ? {
            ...prev.breakdown,
            conversationTokens: prev.breakdown.conversationTokens + tokensDelta,
          }
        : prev?.breakdown;
      return {
        usageByStreamKey: {
          ...state.usageByStreamKey,
          [key]: {
            utilization: nextUtil,
            estimatedTokens: nextTokens,
            breakdown: nextBreakdown,
          },
        },
      };
    });
  },
  clearContextUtilization: (key) =>
    set((state) => {
      const { [key]: _usage, ...rest } = state.usageByStreamKey;
      const { [key]: _ratio, ...ratios } = state.utilPerTokenByStreamKey;
      return { usageByStreamKey: rest, utilPerTokenByStreamKey: ratios };
    }),
  markResetPending: (key) =>
    set((state) => ({
      resetPendingByStreamKey: { ...state.resetPendingByStreamKey, [key]: true },
    })),
  isResetPending: (key) => Boolean(get().resetPendingByStreamKey[key]),
}));

export function useContextUtilization(streamKey: string): number | undefined {
  return useContextUsageStore(
    (state) => state.usageByStreamKey[streamKey]?.utilization,
  );
}

export function useContextUsage(
  streamKey: string,
): ContextUsageEntry | undefined {
  return useContextUsageStore((state) => state.usageByStreamKey[streamKey]);
}

/**
 * Very rough char-to-token estimate used for live mid-turn bumps. 4 chars
 * per token is the widely cited heuristic for English + code; individual
 * tokenizers will disagree but the only consumer is a visual progress
 * pill, which `AssistantMessageEnd` later reconciles to the authoritative
 * server value.
 */
export function approxTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
