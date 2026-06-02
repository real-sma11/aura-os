import { useCallback, useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type { AuraEvent } from "../shared/types/aura-events";
import type { ChatAttachment } from "../shared/types/aura-events/payloads";
import { EventType } from "../shared/types/aura-events";
import type { StreamEventHandler } from "../api/streams";
import { attachToStream } from "../api/streams";
import { subagentsApi } from "../shared/api/subagents";
import {
  BROWSER_DB_STORES,
  browserDbGet,
  browserDbSet,
} from "../shared/lib/browser-db";
import { buildDisplayEvents } from "../utils/build-display-messages";
import {
  ensureEntry,
  createSetters,
  getStreamEntry,
  getThinkingDurationMs,
} from "./stream/store";
import {
  resetStreamBuffers,
  handleTextDelta,
  handleThinkingDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall,
  handleToolResult,
  handleEventSaved,
  handleAssistantTurnBoundary,
  handleStreamError,
  finalizeStream,
  isStreamDroppedError,
} from "./use-stream-core";
import type {
  DisplaySessionEvent,
  StreamSetters,
  StreamRefs,
} from "../shared/types/stream";

/**
 * Independent stream-store partition key for one subagent thread. The
 * partition lives in the module-level stream store, so the projected
 * transcript survives the modal unmounting — reopening the same child
 * run reads the accumulated `events` back rather than starting blank.
 */
export function subagentStreamKey(childRunId: string): string {
  return `subagent:${childRunId}`;
}

const PLACEHOLDER_KEY = "subagent:__inactive__";

/**
 * Module-level record of child runs we have already streamed to a clean
 * terminal frame (`Done` / non-`tool_use` `AssistantMessageEnd`). Once a
 * run is here, reopening the modal renders the persisted `events`
 * snapshot directly instead of re-attaching — so a transcript stays put
 * across open/close even after the harness session that produced it has
 * been reaped (which would otherwise fail a fresh attach and wipe the
 * view). Lives outside React state so it outlives the hook's lifecycle.
 */
const terminallyStreamed = new Set<string>();

/**
 * Ref-counted live attach per `subagent:{childRunId}` partition.
 *
 * The inline view (a `task` card / AURA Council column) and the slide-over
 * panel both call {@link useSubagentChatStream} with the SAME `childRunId`
 * while both are mounted. Without coordination each would open its own
 * `attach` + SSE into the ONE shared module-level partition, racing to
 * `resetStreamBuffers` and double-replaying the transcript — which garbled
 * (or blanked) the inline stream the moment the panel opened. Instead, the
 * first hook to mount for a partition OWNS the attach (its `controller`
 * lives here, not on the hook), additional hooks are pure viewers of the
 * shared partition, and the attach is torn down only when the LAST viewer
 * unmounts — so the owner unmounting while the panel is open does not kill
 * the stream.
 */
interface SharedSubagentAttach {
  count: number;
  controller: AbortController | null;
}
const sharedAttaches = new Map<string, SharedSubagentAttach>();

function acquireSharedAttach(key: string): SharedSubagentAttach {
  let shared = sharedAttaches.get(key);
  if (!shared) {
    shared = { count: 0, controller: null };
    sharedAttaches.set(key, shared);
  }
  shared.count += 1;
  return shared;
}

function releaseSharedAttach(key: string): void {
  const shared = sharedAttaches.get(key);
  if (!shared) return;
  shared.count -= 1;
  if (shared.count <= 0) {
    shared.controller?.abort();
    sharedAttaches.delete(key);
    // Last viewer gone: stop the partition's streaming indicator.
    createSetters(key).setIsStreaming(false);
  }
}

export type SubagentAttachStatus =
  | "idle"
  | "attaching"
  | "live"
  | "done"
  | "error";

export interface SubagentChatThread {
  /** Stream-store partition key driving the reused `ChatPanel`. */
  streamKey: string;
  status: SubagentAttachStatus;
  errorMessage?: string;
  /**
   * Deliver a follow-up user turn into the (still-running) child thread.
   * Mirrors the `ChatPanelProps.onSend` arity so it can be wired
   * straight into the shared input bar; only `content` and
   * `attachments` are forwarded to the subagent send endpoint. Optimis-
   * tically echoes the user bubble into the partition so the transcript
   * reflects the message immediately.
   */
  onSend: (
    content: string,
    action?: string | null,
    selectedModel?: string | null,
    attachments?: ChatAttachment[],
  ) => void;
  /** No-op stop today: a child run is cancelled via its own lifecycle. */
  onStop: () => void;
}

interface SubagentHandlerCallbacks {
  onLive: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Subagent stream error";
}

interface CachedSubagentHistory {
  events: DisplaySessionEvent[];
}

/** Marks a client-side optimistic user echo added by `onSend`. */
const OPTIMISTIC_USER_PREFIX = "subagent-user-";

function isOptimisticUserEcho(event: DisplaySessionEvent): boolean {
  return event.role === "user" && event.id.startsWith(OPTIMISTIC_USER_PREFIX);
}

/**
 * Reconcile an authoritative transcript against any optimistic user
 * echoes already in the partition. An echo whose content the authoritative
 * list already represents (the send was persisted) is dropped so the
 * recorded user turn wins instead of doubling up; an echo with no matching
 * recorded turn yet (send not persisted at fetch time) is preserved and
 * appended so the user's just-sent message is never lost. Counts matches
 * so repeating the same message twice still reconciles one-for-one.
 */
export function reconcileOptimisticUserEchoes(
  authoritative: DisplaySessionEvent[],
  prev: DisplaySessionEvent[],
): DisplaySessionEvent[] {
  const echoes = prev.filter(isOptimisticUserEcho);
  if (echoes.length === 0) return authoritative;

  const remaining = new Map<string, number>();
  for (const event of authoritative) {
    if (event.role === "user") {
      const key = event.content.trim();
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
  }

  const unreconciled: DisplaySessionEvent[] = [];
  for (const echo of echoes) {
    const key = echo.content.trim();
    const matches = remaining.get(key) ?? 0;
    if (matches > 0) {
      remaining.set(key, matches - 1);
    } else {
      unreconciled.push(echo);
    }
  }

  return unreconciled.length > 0 ? [...authoritative, ...unreconciled] : authoritative;
}

/**
 * Best-effort instant paint of a reopened subagent thread from the
 * IndexedDB transcript cache, while the authoritative server fetch (or a
 * live re-attach) revalidates in the background. Reuses the `chatHistory`
 * store keyed by the subagent stream key. Never throws — the cache is a
 * non-authoritative fast-path.
 */
async function hydrateSubagentCache(
  key: string,
  setters: StreamSetters,
): Promise<void> {
  try {
    const cached = await browserDbGet<CachedSubagentHistory>(
      BROWSER_DB_STORES.chatHistory,
      key,
    );
    if (cached && Array.isArray(cached.events) && cached.events.length > 0) {
      setters.setEvents((prev) => reconcileOptimisticUserEchoes(cached.events, prev));
    }
  } catch {
    // Ignore cache read failures; the server fetch is authoritative.
  }
}

/**
 * Fetch the subagent's persisted transcript from its dedicated storage
 * session, seed the partition, and refresh the IndexedDB cache. Returns
 * true when the session had renderable events. Never throws: a fetch
 * failure resolves to false so the caller can fall back to its error
 * path.
 */
async function loadSubagentHistory(
  subagentSessionId: string,
  key: string,
  setters: StreamSetters,
): Promise<boolean> {
  try {
    const events = await subagentsApi.listSessionEvents(subagentSessionId);
    const display = buildDisplayEvents(events);
    if (display.length === 0) return false;
    setters.setEvents((prev) => reconcileOptimisticUserEchoes(display, prev));
    void browserDbSet(BROWSER_DB_STORES.chatHistory, key, {
      events: display,
    } satisfies CachedSubagentHistory).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Build an attach-only stream handler that feeds a child run's events
 * into the shared `subagent:{childRunId}` partition through the SAME
 * lifecycle handlers the main chat uses (`handleAssistantTurnBoundary`
 * / `handleEventSaved` / `finalizeStream`). That snapshots each turn
 * into the partition's `events` slice, so the reused `ChatPanel`
 * renders the child run identically to a top-level chat — and the
 * transcript persists in the store after the stream closes.
 */
function buildSubagentChatHandler(
  key: string,
  refs: StreamRefs,
  setters: StreamSetters,
  abortRef: MutableRefObject<AbortController | null>,
  callbacks: SubagentHandlerCallbacks,
): StreamEventHandler {
  const markDone = (): void => {
    terminallyStreamed.add(key);
    callbacks.onDone();
  };
  return {
    onEvent(event: AuraEvent) {
      callbacks.onLive();
      switch (event.type) {
        case EventType.Delta:
        case EventType.TextDelta: {
          const text = (event.content as { text: string }).text;
          handleTextDelta(refs, setters, getThinkingDurationMs(key), text);
          break;
        }
        case EventType.ThinkingDelta: {
          const c = event.content as { text?: string; thinking?: string };
          handleThinkingDelta(refs, setters, c.text ?? c.thinking ?? "");
          break;
        }
        case EventType.ToolCallStarted:
        case EventType.ToolUseStart: {
          const c = event.content as { id: string; name: string };
          handleToolCallStarted(refs, setters, c);
          break;
        }
        case EventType.ToolCallSnapshot:
          handleToolCallSnapshot(refs, setters, event.content);
          break;
        case EventType.ToolCall:
          handleToolCall(refs, setters, event.content);
          break;
        case EventType.ToolResult: {
          const c = event.content as {
            id?: string;
            tool_use_id?: string;
            name: string;
            result: string;
            is_error: boolean;
          };
          handleToolResult(refs, setters, {
            id: c.id ?? c.tool_use_id,
            name: c.name,
            result: c.result,
            is_error: c.is_error,
          });
          break;
        }
        case EventType.MessageEnd:
          handleEventSaved(refs, setters, event.content.event);
          break;
        case EventType.AssistantMessageEnd: {
          // Snapshot the turn into `events` exactly like the main chat
          // so each assistant turn becomes a persisted bubble. A
          // non-`tool_use` stop reason ends the child run's final turn.
          handleAssistantTurnBoundary(refs, setters);
          const amc = event.content as { stop_reason?: string };
          if (amc.stop_reason !== "tool_use") {
            setters.setIsStreaming(false);
            markDone();
          }
          break;
        }
        case EventType.Done:
          finalizeStream(refs, setters, abortRef, false, { reason: "completed" });
          markDone();
          break;
        case EventType.Error: {
          const content = event.content as { code?: string; message?: string };
          const message = content.message ?? "Subagent stream error";
          // The subagent surface is a read-only re-attach to a child
          // run. When that run finishes, the harness WS closes and the
          // bridge surfaces a recoverable transport-close frame
          // (`harness_ws_closed` / `harness_ws_read_error` / idle
          // timeout / lag). That close is the NORMAL end-of-stream
          // here, not a failure — finalize cleanly so the streamed
          // transcript is kept and no "connection dropped" banner is
          // appended. Gated on having an actual transcript so a
          // genuinely empty / failed attach still falls through to the
          // error state (and its "no longer available" surface).
          const hasTranscript = (getStreamEntry(key)?.events.length ?? 0) > 0;
          if (
            isStreamDroppedError(content, message) &&
            (hasTranscript || terminallyStreamed.has(key))
          ) {
            finalizeStream(refs, setters, abortRef, false, { reason: "completed" });
            markDone();
            break;
          }
          handleStreamError(refs, setters, event.content);
          callbacks.onError(message);
          break;
        }
        default:
          break;
      }
    },
    onError(error: unknown) {
      // Same benign-close handling as the `EventType.Error` arm above,
      // for the transport-level close delivered once the resumable SSE
      // exhausts its retries (e.g. the child WS dropped at end-of-run).
      const hasTranscript = (getStreamEntry(key)?.events.length ?? 0) > 0;
      if (isStreamDroppedError(error) && (hasTranscript || terminallyStreamed.has(key))) {
        finalizeStream(refs, setters, abortRef, false, { reason: "completed" });
        markDone();
        return;
      }
      handleStreamError(refs, setters, error);
      callbacks.onError(errorMessageOf(error));
    },
    onDone() {
      finalizeStream(refs, setters, abortRef, false, { reason: "completed" });
      markDone();
    },
  };
}

/**
 * Drives a subagent child run into a shared stream-store partition so a
 * reused `ChatPanel` can render it as a chat-within-a-chat.
 *
 * When `active` flips true it POSTs to mint an `attach_id`, opens the
 * resumable SSE replay/tail, and feeds events into the partition keyed
 * by `childRunId`. Because the partition is module-level, the projected
 * transcript persists across modal open/close:
 *
 *   - A run we already streamed to a clean terminal frame is replayed
 *     from the persisted `events` snapshot WITHOUT re-attaching, so the
 *     transcript survives even after the harness session was reaped.
 *   - A live (non-terminal) run re-attaches and replays from seq 0,
 *     clearing the partition first so the replay does not double up.
 *   - A failed attach falls back to the subagent's persisted transcript
 *     (fetched from its dedicated storage session via `subagentSessionId`,
 *     with an IndexedDB fast-path) so a thread reopened after an app
 *     restart — when the live child run is long gone — still renders its
 *     saved history instead of an "unavailable" error.
 */
export function useSubagentChatStream(
  childRunId: string | undefined,
  parentToolUseId: string | undefined,
  active: boolean,
  subagentSessionId?: string,
  parentAgentId?: string,
): SubagentChatThread {
  const streamKey = childRunId ? subagentStreamKey(childRunId) : PLACEHOLDER_KEY;
  const [status, setStatus] = useState<SubagentAttachStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!active || !childRunId) return;

    // Ref-count this partition's live attach. The first mounted hook for
    // a `childRunId` owns the attach; any additional hook (e.g. the
    // slide-over panel opened over an inline card) is a pure viewer of the
    // shared partition and must NOT open a second attach.
    const shared = acquireSharedAttach(streamKey);
    const isOwner = shared.controller === null;

    if (!isOwner) {
      // Viewer-only: reflect the shared partition the owner is populating.
      const entry = getStreamEntry(streamKey);
      const hasTranscript = (entry?.events.length ?? 0) > 0;
      if (terminallyStreamed.has(streamKey) || hasTranscript) {
        setStatus("live");
      } else {
        // Owner is still attaching; show a loading state until the shared
        // partition fills rather than a spurious empty/error view.
        setStatus("attaching");
      }
      setErrorMessage(undefined);
      return () => {
        releaseSharedAttach(streamKey);
      };
    }

    const controller = new AbortController();
    shared.controller = controller;
    const abortRef: MutableRefObject<AbortController | null> = { current: controller };
    let cancelled = false;

    const meta = ensureEntry(streamKey);
    const setters = createSetters(streamKey);

    const handler = buildSubagentChatHandler(streamKey, meta.refs, setters, abortRef, {
      onLive: () => {
        if (!cancelled) setStatus((prev) => (prev === "attaching" ? "live" : prev));
      },
      onDone: () => {
        if (!cancelled) setStatus("done");
      },
      onError: (message) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(message);
      },
    });

    // All React state transitions live inside this async flow so none run
    // synchronously in the effect body (react-hooks/set-state-in-effect).
    const run = async (): Promise<void> => {
      // Already streamed to completion: render the persisted transcript
      // from the store and skip the (possibly now-impossible) re-attach.
      if (terminallyStreamed.has(streamKey) && getStreamEntry(streamKey)?.events.length) {
        setStatus("done");
        setErrorMessage(undefined);
        return;
      }
      // Instant paint from the IndexedDB cache while we revalidate, but
      // only when the partition is empty so we never clobber an in-session
      // live transcript.
      if (subagentSessionId && !getStreamEntry(streamKey)?.events.length) {
        await hydrateSubagentCache(streamKey, setters);
        if (cancelled || controller.signal.aborted) return;
      }
      setStatus("attaching");
      setErrorMessage(undefined);
      try {
        const res = await subagentsApi.attach(
          childRunId,
          parentToolUseId,
          parentAgentId,
        );
        if (cancelled || controller.signal.aborted) return;
        // Attach succeeded — a fresh replay from seq 0 is incoming. We no
        // longer blank the partition first: that made the whole transcript
        // flash empty before the replay rebuilt it (visible when reopening
        // a still-streaming subagent). `handleEventSaved` now dedupes
        // re-delivered turns by `event_id` and replaces them in place, so
        // the replay reconciles against the existing events without
        // stacking duplicates and without the blink. Only the partial
        // streaming buffer is reset so a half-streamed turn doesn't double.
        resetStreamBuffers(meta.refs, setters);
        setters.setIsStreaming(true);
        setStatus("live");
        attachToStream(res.attach_id, 0, handler, controller.signal, {
          onResync: () => {
            // Backlog evicted: reset only the partial streaming buffer and
            // let the live tail repopulate; committed turns dedupe by id.
            resetStreamBuffers(meta.refs, setters);
          },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        // Live run is gone (reaped on a prior app session). Fall back to
        // the persisted transcript so a reopened thread renders its saved
        // history rather than an error. Leave any already-accumulated
        // events intact when no session id / no persisted rows exist.
        if (subagentSessionId) {
          const loaded = await loadSubagentHistory(subagentSessionId, streamKey, setters);
          if (cancelled || controller.signal.aborted) return;
          if (loaded || getStreamEntry(streamKey)?.events.length) {
            terminallyStreamed.add(streamKey);
            setters.setIsStreaming(false);
            setStatus("done");
            setErrorMessage(undefined);
            return;
          }
        }
        setStatus("error");
        setErrorMessage(errorMessageOf(error));
      }
    };
    void run();

    return () => {
      cancelled = true;
      // Release this viewer. The shared attach (and its controller) is
      // aborted only when the LAST viewer unmounts, so closing the panel
      // while the inline card stays mounted — or vice versa — never kills
      // a still-live stream.
      releaseSharedAttach(streamKey);
    };
  }, [active, childRunId, parentToolUseId, streamKey, subagentSessionId, parentAgentId]);

  const onSend = useCallback(
    (
      content: string,
      _action?: string | null,
      _selectedModel?: string | null,
      attachments?: ChatAttachment[],
    ) => {
      const trimmed = content.trim();
      if (!childRunId || trimmed.length === 0) return;

      const setters = createSetters(streamKey);
      const id = `${OPTIMISTIC_USER_PREFIX}${Date.now()}`;
      // Optimistically echo the user's message so the transcript shows
      // it immediately; the harness reply streams back over the existing
      // attach.
      setters.setEvents((prev) => [
        ...prev,
        { id, clientId: id, role: "user", content: trimmed },
      ]);
      setters.setIsStreaming(true);

      void subagentsApi
        .send(childRunId, trimmed, attachments)
        .then(() => {
          if (!terminallyStreamed.has(streamKey)) return;
          // A previously-terminal thread will not emit fresh frames over
          // the (now-closed) attach; surface a calm system note instead
          // of a spinner that never resolves.
          setters.setIsStreaming(false);
        })
        .catch((error: unknown) => {
          setters.setIsStreaming(false);
          const noteId = `subagent-send-error-${Date.now()}`;
          setters.setEvents((prev) => [
            ...prev,
            {
              id: noteId,
              clientId: noteId,
              role: "system",
              content:
                error instanceof Error
                  ? error.message
                  : "Could not deliver the message to this subagent.",
            },
          ]);
        });
    },
    [childRunId, streamKey],
  );

  const onStop = useCallback(() => {
    if (childRunId) createSetters(subagentStreamKey(childRunId)).setIsStreaming(false);
  }, [childRunId]);

  return { streamKey, status, errorMessage, onSend, onStop };
}
