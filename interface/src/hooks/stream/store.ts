import { create } from "zustand";
import type { SetStateAction } from "react";
import type {
  DisplaySessionEvent,
  ToolCallEntry,
  TimelineItem,
  StreamRefs,
  StreamSetters,
  GenerationKind,
} from "../../shared/types/stream";
import { clearPartitionSendControl } from "../use-chat-stream/partition-send-control";

/* ------------------------------------------------------------------ */
/*  Zustand stream store                                               */
/*                                                                     */
/*  Keeps reactive stream state in a Zustand store so components can   */
/*  subscribe to individual slices. Non-reactive metadata (refs,       */
/*  abort controllers) live in a module-level Map.                     */
/* ------------------------------------------------------------------ */

export interface StreamEntryState {
  isStreaming: boolean;
  // True while streamed text is actively revealing word-by-word (i.e. the
  // displayed slice is still catching up to the buffered text). Drives the
  // cooking indicator: it shows whenever the turn is in flow but we are not
  // actively writing tokens to the screen.
  isWriting: boolean;
  events: DisplaySessionEvent[];
  streamingText: string;
  thinkingText: string;
  thinkingDurationMs: number | null;
  activeToolCalls: ToolCallEntry[];
  timeline: TimelineItem[];
  progressText: string;
  // Wall-clock ms of the most recent SSE-driven setter call (any of
  // text/thinking/tool/event/progress/timeline). `null` when no
  // wire event has been observed for the entry yet. Drives the
  // stuck-stream watchdog (`useStreamHealth`).
  lastEventAt: number | null;
  // Wall-clock ms when the watchdog first noticed `isStreaming` was
  // true while `lastEventAt` had aged past `STUCK_THRESHOLD_MS`.
  // Cleared whenever a fresh wire event lands. Set/cleared by the
  // watchdog itself via `setStuckSince`; entry setters only clear it
  // alongside bumping `lastEventAt`.
  stuckSince: number | null;
  // Generation-lifecycle metadata. Populated when the entry is
  // driving an image/3D/video stream so the cooking-indicator ETA
  // countdown (`useGenerationEta`) can read the start wall-clock,
  // model id, and latest reported percent. All three are cleared
  // together on terminal events (completion / error) and on stream
  // reset so the countdown disappears the moment the stream ends.
  generationStartedAt: number | null;
  generationModel: string | null;
  generationKind: GenerationKind | null;
  // Latest `percent` reported by an upstream `generation_progress`
  // SSE frame, when present. Used to refine the initial per-model
  // fallback estimate into `elapsed * (100 - percent) / percent`
  // once meaningful (>= 5) progress lands.
  generationPercent: number | null;
}

export interface StreamMeta {
  key: string;
  refs: StreamRefs;
  abort: AbortController | null;
  lastAccessedAt: number;
}

interface StreamStore {
  entries: Record<string, StreamEntryState>;
}

const INITIAL_ENTRY: StreamEntryState = {
  isStreaming: false,
  isWriting: false,
  events: [],
  streamingText: "",
  thinkingText: "",
  thinkingDurationMs: null,
  activeToolCalls: [],
  timeline: [],
  progressText: "",
  lastEventAt: null,
  stuckSince: null,
  generationStartedAt: null,
  generationModel: null,
  generationKind: null,
  generationPercent: null,
};

export const useStreamStore = create<StreamStore>()(() => ({
  entries: {},
}));

export const streamMetaMap = new Map<string, StreamMeta>();
const STREAM_STORE_MAX_ENTRIES = 40;
const STREAM_STORE_IDLE_TTL_MS = 5 * 60 * 1000;
// Entries that hold a finalized turn (events non-empty, not actively
// streaming) are protected from eviction for this window so that
// in-session collapse/expand and navigation away/back keep the rich
// post-completion view without re-hitting the persisted turn cache.
const STREAM_STORE_FINALIZED_PROTECT_MS = 30 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Shared event-bus subscriptions, refcounted per streamKey.          */
/*                                                                     */
/*  Multiple components frequently mount the same useTaskStream /      */
/*  useProcessNodeStream for a given key (e.g. a task rendered both    */
/*  as a TaskPreview in the chat row and as ActiveTaskStream in the    */
/*  sidekick Run tab). Without this registry each mount independently  */
/*  subscribes to the shared event-store EventTypes, and every         */
/*  callback writes into the same streamKey-scoped refs — so a single  */
/*  WS event fans out to N duplicate tool cards / timeline rows. The   */
/*  refcounted registrar guarantees one subscription set per key no    */
/*  matter how many consumers mount.                                    */
/* ------------------------------------------------------------------ */

interface SharedSubscriptionEntry {
  refCount: number;
  disposers: Array<() => void>;
}

const sharedSubscriptions = new Map<string, SharedSubscriptionEntry>();

/**
 * Acquire the shared set of event-bus subscriptions for `key`. If this
 * is the first acquire the `register` callback runs and its returned
 * disposers are stored. Subsequent acquires just bump the refcount. The
 * returned release function is idempotent; when the last consumer
 * releases, the stored disposers run and the entry is dropped.
 */
export function acquireSharedStreamSubscriptions(
  key: string,
  register: () => Array<() => void>,
): () => void {
  let entry = sharedSubscriptions.get(key);
  if (!entry) {
    entry = { refCount: 0, disposers: register() };
    sharedSubscriptions.set(key, entry);
  }
  entry.refCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = sharedSubscriptions.get(key);
    if (!current) return;
    current.refCount -= 1;
    if (current.refCount <= 0) {
      for (const dispose of current.disposers) {
        try {
          dispose();
        } catch {
          // Disposer failures should not block further cleanup.
        }
      }
      sharedSubscriptions.delete(key);
    }
  };
}

/** Test-only: returns the current refcount for a shared subscription. */
export function peekSharedSubscriptionRefCount(key: string): number {
  return sharedSubscriptions.get(key)?.refCount ?? 0;
}

export function storeKey(deps: unknown[]): string {
  return deps.filter(Boolean).join(":");
}

function makeRefs(): StreamRefs {
  return {
    streamBuffer: { current: "" },
    thinkingBuffer: { current: "" },
    thinkingStart: { current: null },
    toolCalls: { current: [] },
    raf: { current: null },
    flushTimeout: { current: null },
    displayedTextLength: { current: 0 },
    lastTextFlushAt: { current: 0 },
    thinkingRaf: { current: null },
    timeline: { current: [] },
    snapshottedToolCallIds: { current: new Set() },
  };
}

export function ensureEntry(key: string): StreamMeta {
  let meta = streamMetaMap.get(key);
  if (!meta) {
    meta = { key, refs: makeRefs(), abort: null, lastAccessedAt: Date.now() };
    streamMetaMap.set(key, meta);
    useStreamStore.setState((s) => ({
      entries: { ...s.entries, [key]: { ...INITIAL_ENTRY } },
    }));
  }
  meta.lastAccessedAt = Date.now();
  return meta;
}

function touchEntry(key: string): void {
  const meta = streamMetaMap.get(key);
  if (meta) meta.lastAccessedAt = Date.now();
}

function isFinalizedProtected(
  key: string,
  entries: Record<string, StreamEntryState>,
  meta: StreamMeta,
  now: number,
): boolean {
  const entry = entries[key];
  if (!entry) return false;
  if (entry.isStreaming) return true;
  if (entry.events.length === 0) return false;
  return now - meta.lastAccessedAt <= STREAM_STORE_FINALIZED_PROTECT_MS;
}

export function pruneStreamStore(preserveKey?: string): void {
  const now = Date.now();
  const entries = useStreamStore.getState().entries;
  const toDelete: string[] = [];

  for (const [key, meta] of streamMetaMap) {
    if (key === preserveKey) continue;
    if (entries[key]?.isStreaming) continue;
    if (isFinalizedProtected(key, entries, meta, now)) continue;
    if (now - meta.lastAccessedAt > STREAM_STORE_IDLE_TTL_MS) {
      toDelete.push(key);
    }
  }

  if (streamMetaMap.size - toDelete.length > STREAM_STORE_MAX_ENTRIES) {
    const removable = [...streamMetaMap.entries()]
      .filter(([key, meta]) =>
        key !== preserveKey &&
        !entries[key]?.isStreaming &&
        !toDelete.includes(key) &&
        !isFinalizedProtected(key, entries, meta, now),
      )
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    for (const [key] of removable) {
      if (streamMetaMap.size - toDelete.length <= STREAM_STORE_MAX_ENTRIES) break;
      toDelete.push(key);
    }
  }

  if (toDelete.length === 0) return;

  for (const key of toDelete) {
    streamMetaMap.delete(key);
    // Keep the partition-send-control map in lockstep with the stream meta
    // so an evicted partition doesn't leak its retry timer / cached send
    // payload past its last live handler.
    clearPartitionSendControl(key);
  }
  useStreamStore.setState((s) => {
    const next = { ...s.entries };
    for (const key of toDelete) delete next[key];
    return { entries: next };
  });
}

export function resolve<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === "function"
    ? (action as (p: T) => T)(prev)
    : action;
}

function updateStreamEntry(key: string, patch: Partial<StreamEntryState>): void {
  useStreamStore.setState((s) => {
    const existing = s.entries[key];
    if (!existing) return s;
    return { entries: { ...s.entries, [key]: { ...existing, ...patch } } };
  });
}

export function getStreamEntry(key: string): StreamEntryState | undefined {
  return useStreamStore.getState().entries[key];
}

/**
 * Seed a stream entry's `events` array from a persisted cache when
 * the live entry is empty. Used by `useTaskOutputView` so reopening a
 * finalized task after the in-memory entry has been pruned still
 * renders the full structured turn history without a server round
 * trip. No-ops when the entry already has events or is streaming so
 * we never clobber live data.
 */
export function seedStreamEventsFromCache(
  key: string,
  events: DisplaySessionEvent[],
): void {
  if (!key || !events || events.length === 0) return;
  ensureEntry(key);
  useStreamStore.setState((s) => {
    const existing = s.entries[key];
    if (!existing) return s;
    if (existing.isStreaming) return s;
    if (existing.events.length > 0) return s;
    return {
      entries: {
        ...s.entries,
        [key]: { ...existing, events },
      },
    };
  });
}

export function getIsStreaming(key: string): boolean {
  return useStreamStore.getState().entries[key]?.isStreaming ?? false;
}

export function getThinkingDurationMs(key: string): number | null {
  return useStreamStore.getState().entries[key]?.thinkingDurationMs ?? null;
}

/**
 * Last wall-clock ms at which an SSE-driven setter ran for `key`.
 * `null` when no wire event has landed yet (or the entry has been
 * pruned). Read by `useStreamHealth` and the chat send guards so a
 * stuck-stream "send anyway" decision can be made without a hook
 * subscription.
 */
export function getLastEventAt(key: string): number | null {
  return useStreamStore.getState().entries[key]?.lastEventAt ?? null;
}

/**
 * Bump the wire-event clock for `key`. Called from every setter that
 * maps to an SSE event (text / thinking / tool / progress /
 * timeline / events). Setting `lastEventAt` to "now" and clearing
 * `stuckSince` happens in a single `setState` so a watchdog tick
 * never observes a half-updated entry. UI lifecycle setters
 * (`setIsStreaming`, `setIsWriting`) deliberately do NOT call this:
 * the streaming-true flip on send is not a wire event, and clearing
 * it on completion shouldn't pretend a fresh event landed.
 *
 * Exported for handlers that observe a wire event without driving
 * any setter — currently the `generation_partial_image` SSE arm in
 * the chat-stream handlers, which would otherwise let the
 * `useStuckStreamAutoTimeout` watchdog auto-abort a long
 * partial-image render (e.g. `gpt-image-2`) that legitimately
 * exceeds 60s between `progress` frames.
 */
export function markStreamProgress(key: string): void {
  const now = Date.now();
  useStreamStore.setState((s) => {
    const existing = s.entries[key];
    if (!existing) return s;
    return {
      entries: {
        ...s.entries,
        [key]: { ...existing, lastEventAt: now, stuckSince: null },
      },
    };
  });
}

/**
 * Watchdog-side setter for `stuckSince`. Exposed so
 * `useStreamHealth` can stamp the moment it first observed a stale
 * entry without piggybacking on a wire-event setter.
 */
export function setStuckSince(key: string, value: number | null): void {
  useStreamStore.setState((s) => {
    const existing = s.entries[key];
    if (!existing) return s;
    if (existing.stuckSince === value) return s;
    return {
      entries: {
        ...s.entries,
        [key]: { ...existing, stuckSince: value },
      },
    };
  });
}

/**
 * Create setters that update the Zustand store.
 * Same StreamSetters interface so handlers work unchanged.
 */
export function createSetters(key: string): StreamSetters {
  return {
    setStreamingText(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { streamingText: resolve(v, cur?.streamingText ?? "") });
      markStreamProgress(key);
    },
    setThinkingText(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { thinkingText: resolve(v, cur?.thinkingText ?? "") });
      markStreamProgress(key);
    },
    setThinkingDurationMs(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { thinkingDurationMs: resolve(v, cur?.thinkingDurationMs ?? null) });
      markStreamProgress(key);
    },
    setActiveToolCalls(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { activeToolCalls: resolve(v, cur?.activeToolCalls ?? []) });
      markStreamProgress(key);
    },
    setEvents(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { events: resolve(v, cur?.events ?? []) });
      markStreamProgress(key);
    },
    setIsStreaming(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      const wasStreaming = cur?.isStreaming ?? false;
      const next = resolve(v, wasStreaming);
      const patch: Partial<StreamEntryState> = { isStreaming: next };
      // false -> true edge: rebase the stuck-stream watchdog clock so a
      // follow-up send on a session whose prior turn ended >STUCK_THRESHOLD_MS
      // ago doesn't render the pill instantly off the stale lastEventAt.
      if (next && !wasStreaming) {
        patch.lastEventAt = Date.now();
        patch.stuckSince = null;
      }
      updateStreamEntry(key, patch);
    },
    setIsWriting(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { isWriting: resolve(v, cur?.isWriting ?? false) });
    },
    setProgressText(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { progressText: resolve(v, cur?.progressText ?? "") });
      markStreamProgress(key);
    },
    setTimeline(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { timeline: resolve(v, cur?.timeline ?? []) });
      markStreamProgress(key);
    },
    setGenerationState(v) {
      touchEntry(key);
      updateStreamEntry(key, {
        generationStartedAt: v.startedAt,
        generationModel: v.model,
        generationKind: v.kind,
        // A fresh start always resets the percent so a previous turn's
        // trailing value can't seed the next countdown's adaptive
        // estimate.
        generationPercent: null,
      });
    },
    setGenerationPercent(v) {
      touchEntry(key);
      updateStreamEntry(key, { generationPercent: v });
      // Wire activity — keep the stuck-stream watchdog clock fresh.
      markStreamProgress(key);
    },
    clearGeneration() {
      touchEntry(key);
      updateStreamEntry(key, {
        generationStartedAt: null,
        generationModel: null,
        generationKind: null,
        generationPercent: null,
      });
    },
  };
}
