import { useEffect, useState } from "react";
import type {
  StreamRefs,
  StreamSetters,
  TimelineItem,
  ToolCallEntry,
} from "../shared/types/stream";
import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import type { StreamEventHandler } from "../api/streams";
import { attachToStream } from "../api/streams";
import { subagentsApi } from "../shared/api/subagents";
import {
  ensureEntry,
  createSetters,
  getThinkingDurationMs,
} from "./stream/store";
import {
  useTimeline,
  useActiveToolCalls,
  useStreamingText,
  useThinkingText,
  useThinkingDurationMs,
  useIsStreaming,
} from "./stream/hooks";
import {
  handleTextDelta,
  handleThinkingDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall,
  handleToolResult,
  resetStreamBuffers,
} from "./use-stream-core";
import { flushStreamingText } from "./stream/handlers/shared";

/** Independent stream-store partition key for one subagent thread. */
export function subagentStreamKey(childRunId: string): string {
  return `subagent:${childRunId}`;
}

const PLACEHOLDER_KEY = "subagent:__inactive__";

export type SubagentAttachStatus =
  | "idle"
  | "attaching"
  | "live"
  | "done"
  | "error";

export interface SubagentThreadView {
  timeline: TimelineItem[];
  toolCalls: ToolCallEntry[];
  streamingText: string;
  thinkingText: string;
  thinkingDurationMs: number | null;
  isStreaming: boolean;
  status: SubagentAttachStatus;
  errorMessage?: string;
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
 * into a single accumulating `subagent:{childRunId}` partition. Unlike
 * the parent chat handler this intentionally does NOT snapshot turns
 * into `events` / clear the timeline on each `assistant_message_end`, so
 * the modal renders one continuous transcript that survives completion.
 */
function buildSubagentStreamHandler(
  key: string,
  refs: StreamRefs,
  setters: StreamSetters,
  callbacks: SubagentHandlerCallbacks,
): StreamEventHandler {
  const stop = (): void => {
    flushStreamingText(refs, setters);
    setters.setIsStreaming(false);
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
        case EventType.AssistantMessageEnd: {
          const amc = event.content as { stop_reason?: string };
          // A non-`tool_use` stop reason ends the child run's final
          // turn. Reveal any buffered text and stop the live spinner,
          // but keep the accumulated timeline intact.
          if (amc.stop_reason !== "tool_use") {
            stop();
            callbacks.onDone();
          }
          break;
        }
        case EventType.Done:
          stop();
          callbacks.onDone();
          break;
        case EventType.Error: {
          const message =
            (event.content as { message?: string }).message ??
            "Subagent stream error";
          stop();
          callbacks.onError(message);
          break;
        }
        default:
          break;
      }
    },
    onError(error: unknown) {
      flushStreamingText(refs, setters);
      setters.setIsStreaming(false);
      callbacks.onError(errorMessageOf(error));
    },
    onDone() {
      flushStreamingText(refs, setters);
      setters.setIsStreaming(false);
      callbacks.onDone();
    },
  };
}

/**
 * Attach-only live view of a subagent thread. When `active` flips true
 * it POSTs to mint an `attach_id`, opens the resumable SSE replay/tail,
 * and feeds events into an independent stream partition keyed by
 * `childRunId`. Aborts the attach (and stops the local spinner) on
 * close/unmount. Reactive timeline/tool/text slices are read back from
 * the same partition so the modal re-renders as frames arrive.
 */
export function useSubagentThread(
  childRunId: string | undefined,
  parentToolUseId: string | undefined,
  active: boolean,
): SubagentThreadView {
  const key = childRunId ? subagentStreamKey(childRunId) : PLACEHOLDER_KEY;
  const [status, setStatus] = useState<SubagentAttachStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const timeline = useTimeline(key);
  const toolCalls = useActiveToolCalls(key);
  const streamingText = useStreamingText(key);
  const thinkingText = useThinkingText(key);
  const thinkingDurationMs = useThinkingDurationMs(key);
  const isStreaming = useIsStreaming(key);

  useEffect(() => {
    if (!active || !childRunId) return;
    const controller = new AbortController();
    let cancelled = false;

    const meta = ensureEntry(key);
    const setters = createSetters(key);
    // Reset so a fresh attach (replay from seq 0) does not double up on
    // a previously-watched transcript still cached in this partition.
    // (Store updates — not React setState — so they stay synchronous.)
    resetStreamBuffers(meta.refs, setters);
    setters.setIsStreaming(true);

    const handler = buildSubagentStreamHandler(key, meta.refs, setters, {
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

    // All React state transitions live inside this async flow so none
    // run synchronously in the effect body (react-hooks/set-state-in-effect).
    const run = async (): Promise<void> => {
      setStatus("attaching");
      setErrorMessage(undefined);
      try {
        const res = await subagentsApi.attach(childRunId, parentToolUseId);
        if (cancelled || controller.signal.aborted) return;
        setStatus("live");
        attachToStream(res.attach_id, 0, handler, controller.signal, {
          onResync: () => {
            // Backlog evicted: clear and let the live tail repopulate.
            resetStreamBuffers(meta.refs, createSetters(key));
          },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(errorMessageOf(error));
      }
    };
    void run();

    return () => {
      cancelled = true;
      controller.abort();
      createSetters(key).setIsStreaming(false);
    };
  }, [active, childRunId, parentToolUseId, key]);

  return {
    timeline,
    toolCalls,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    isStreaming,
    status,
    errorMessage,
  };
}
