import { useCallback, useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type { AuraEvent } from "../shared/types/aura-events";
import type { ChatAttachment } from "../shared/types/aura-events/payloads";
import { EventType } from "../shared/types/aura-events";
import type { StreamEventHandler } from "../api/streams";
import { attachToStream } from "../api/streams";
import { subagentsApi } from "../shared/api/subagents";
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
} from "./use-stream-core";
import type { StreamSetters, StreamRefs } from "../shared/types/stream";

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
          const message =
            (event.content as { message?: string }).message ??
            "Subagent stream error";
          handleStreamError(refs, setters, event.content);
          callbacks.onError(message);
          break;
        }
        default:
          break;
      }
    },
    onError(error: unknown) {
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
 *   - A failed attach leaves any previously-accumulated `events` intact
 *     rather than wiping them — the root-cause fix for the prior
 *     ephemeral hook, which reset on every reopen and lost the thread.
 */
export function useSubagentChatStream(
  childRunId: string | undefined,
  parentToolUseId: string | undefined,
  active: boolean,
): SubagentChatThread {
  const streamKey = childRunId ? subagentStreamKey(childRunId) : PLACEHOLDER_KEY;
  const [status, setStatus] = useState<SubagentAttachStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!active || !childRunId) return;

    const controller = new AbortController();
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
      setStatus("attaching");
      setErrorMessage(undefined);
      try {
        const res = await subagentsApi.attach(childRunId, parentToolUseId);
        if (cancelled || controller.signal.aborted) return;
        // Attach succeeded — a fresh replay from seq 0 is incoming.
        // Clear the partition first so the replayed turns don't stack
        // on top of any previously-accumulated events. (Store writes,
        // not React setState, so they apply synchronously before the
        // first SSE frame lands.)
        setters.setEvents([]);
        resetStreamBuffers(meta.refs, setters);
        setters.setIsStreaming(true);
        setStatus("live");
        attachToStream(res.attach_id, 0, handler, controller.signal, {
          onResync: () => {
            // Backlog evicted: clear and let the live tail repopulate.
            setters.setEvents([]);
            resetStreamBuffers(meta.refs, setters);
          },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        // Leave any persisted events untouched so closing/reopening a
        // finished-but-reaped thread keeps its transcript.
        setStatus("error");
        setErrorMessage(errorMessageOf(error));
      }
    };
    void run();

    return () => {
      cancelled = true;
      controller.abort();
      createSetters(streamKey).setIsStreaming(false);
    };
  }, [active, childRunId, parentToolUseId, streamKey]);

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
      const id = `subagent-user-${Date.now()}`;
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
