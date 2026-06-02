import { renderHook, act } from "@testing-library/react";
import { EventType, type AuraEvent } from "../shared/types/aura-events";
import type { StreamEventHandler } from "../api/streams";

const mockAttach = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
const mockListSessionEvents = vi.hoisted(() => vi.fn());
const mockAttachToStream = vi.hoisted(() => vi.fn());

vi.mock("../shared/api/subagents", () => ({
  subagentsApi: {
    attach: mockAttach,
    send: mockSend,
    listSessionEvents: mockListSessionEvents,
  },
}));

vi.mock("../shared/lib/browser-db", () => ({
  BROWSER_DB_STORES: { chatHistory: "chatHistory" },
  browserDbGet: vi.fn().mockResolvedValue(null),
  browserDbSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock(import("../api/streams"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, attachToStream: mockAttachToStream };
});

import {
  useSubagentChatStream,
  subagentStreamKey,
  reconcileOptimisticUserEchoes,
} from "./use-subagent-chat-stream";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { useStreamStore, streamMetaMap, getStreamEntry } from "./stream/store";

function evt(type: EventType, content: Record<string, unknown>): AuraEvent {
  return { type, content } as unknown as AuraEvent;
}

/** Drive a short assistant turn through the captured stream handler. */
function streamTurn(
  handler: StreamEventHandler,
  text: string,
  stopReason: string,
): void {
  handler.onEvent(evt(EventType.TextDelta, { text }));
  handler.onEvent(evt(EventType.AssistantMessageEnd, { stop_reason: stopReason }));
}

describe("useSubagentChatStream", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    vi.clearAllMocks();
  });

  it("replays the child run into the shared partition's events", async () => {
    const childRunId = "child-replay";
    mockAttach.mockResolvedValue({ attach_id: "att-1", child_run_id: childRunId });
    mockAttachToStream.mockImplementation(
      (_id: string, _since: number, handler: StreamEventHandler) => {
        streamTurn(handler, "Hello from subagent", "end_turn");
      },
    );

    const { result } = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    const key = subagentStreamKey(childRunId);
    expect(result.current.streamKey).toBe(key);
    expect(getStreamEntry(key)?.events.length).toBeGreaterThan(0);
    expect(result.current.status).toBe("done");
  });

  it("keeps the persisted transcript when a non-terminal run is reopened and re-attach fails", async () => {
    const childRunId = "child-reopen";
    const key = subagentStreamKey(childRunId);

    // First open: attach succeeds but the run only reaches a tool_use
    // boundary (not terminal), leaving a snapshotted turn in `events`.
    mockAttach.mockResolvedValueOnce({ attach_id: "att-1", child_run_id: childRunId });
    mockAttachToStream.mockImplementationOnce(
      (_id: string, _since: number, handler: StreamEventHandler) => {
        streamTurn(handler, "Working on it", "tool_use");
      },
    );

    const first = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    const eventsAfterFirst = getStreamEntry(key)?.events.length ?? 0;
    expect(eventsAfterFirst).toBeGreaterThan(0);

    // Close the modal.
    first.unmount();

    // Reopen: the harness session has been reaped, so the re-attach
    // rejects. The previously-accumulated events must NOT be wiped.
    mockAttach.mockRejectedValueOnce(new Error("thread no longer available"));

    const second = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    expect(getStreamEntry(key)?.events.length).toBe(eventsAfterFirst);
    expect(second.result.current.status).toBe("error");
  });

  it("loads the persisted transcript when a reaped run is reopened with a subagentSessionId", async () => {
    const childRunId = "child-restart";
    const key = subagentStreamKey(childRunId);

    // App restart: the live child run is long gone, so the attach
    // rejects. With a subagentSessionId the hook must fetch and render
    // the persisted transcript from the subagent's storage session
    // instead of surfacing the "unavailable" error.
    mockAttach.mockRejectedValueOnce(new Error("thread no longer available"));
    mockListSessionEvents.mockResolvedValueOnce([
      {
        event_id: "evt-1",
        role: "assistant",
        content: "Restored subagent answer",
        content_blocks: [],
        thinking: null,
        thinking_duration_ms: null,
      },
    ]);

    const { result } = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true, "subagent-session-1"),
    );
    await act(async () => {});

    expect(mockListSessionEvents).toHaveBeenCalledWith("subagent-session-1");
    expect(getStreamEntry(key)?.events.length).toBeGreaterThan(0);
    expect(result.current.status).toBe("done");
  });

  it("falls back to the error state when a reaped run has no persisted session", async () => {
    const childRunId = "child-no-session";
    mockAttach.mockRejectedValueOnce(new Error("thread no longer available"));

    const { result } = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    expect(mockListSessionEvents).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
  });

  it("renders a completed run from the persisted snapshot without re-attaching", async () => {
    const childRunId = "child-terminal";
    const key = subagentStreamKey(childRunId);

    mockAttach.mockResolvedValueOnce({ attach_id: "att-1", child_run_id: childRunId });
    mockAttachToStream.mockImplementationOnce(
      (_id: string, _since: number, handler: StreamEventHandler) => {
        streamTurn(handler, "All done", "end_turn");
      },
    );

    const first = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});
    const eventsAfterFirst = getStreamEntry(key)?.events.length ?? 0;
    first.unmount();

    mockAttach.mockClear();

    const second = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    expect(mockAttach).not.toHaveBeenCalled();
    expect(getStreamEntry(key)?.events.length).toBe(eventsAfterFirst);
    expect(second.result.current.status).toBe("done");
  });

  it("stays idle while inactive", () => {
    const { result } = renderHook(() =>
      useSubagentChatStream("child-x", "tool-1", false),
    );
    expect(result.current.status).toBe("idle");
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it("prompts a live subagent and echoes the user message into the partition", async () => {
    const childRunId = "child-prompt";
    const key = subagentStreamKey(childRunId);
    mockAttach.mockResolvedValue({ attach_id: "att-1", child_run_id: childRunId });
    mockAttachToStream.mockImplementation(
      (_id: string, _since: number, handler: StreamEventHandler) => {
        streamTurn(handler, "Working", "tool_use");
      },
    );
    mockSend.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    const before = getStreamEntry(key)?.events.length ?? 0;
    act(() => {
      result.current.onSend("follow up question");
    });

    expect(mockSend).toHaveBeenCalledWith(childRunId, "follow up question", undefined);
    const after = getStreamEntry(key)?.events ?? [];
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      role: "user",
      content: "follow up question",
    });
  });

  it("ignores blank prompts", async () => {
    const childRunId = "child-blank";
    mockAttach.mockResolvedValue({ attach_id: "att-1", child_run_id: childRunId });
    mockAttachToStream.mockImplementation(() => {});

    const { result } = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    act(() => {
      result.current.onSend("   ");
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("treats a harness WS close after a streamed turn as a clean finish, not a dropped-stream error", async () => {
    const childRunId = "child-ws-close";
    const key = subagentStreamKey(childRunId);
    mockAttach.mockResolvedValue({ attach_id: "att-1", child_run_id: childRunId });
    mockAttachToStream.mockImplementation(
      (_id: string, _since: number, handler: StreamEventHandler) => {
        // Content streamed, then the (finished) child run's WS closes,
        // which the bridge surfaces as a recoverable transport-close.
        streamTurn(handler, "Partial work before the run finished", "tool_use");
        handler.onEvent(
          evt(EventType.Error, {
            code: "harness_ws_closed",
            message: "harness websocket closed",
          }),
        );
      },
    );

    const { result } = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    const events = getStreamEntry(key)?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(
      events.some(
        (e) => (e as { displayVariant?: string }).displayVariant === "streamDropped",
      ),
    ).toBe(false);
    expect(result.current.status).toBe("done");
  });

  it("still surfaces a genuine subagent error frame", async () => {
    const childRunId = "child-real-error";
    mockAttach.mockResolvedValue({ attach_id: "att-1", child_run_id: childRunId });
    mockAttachToStream.mockImplementation(
      (_id: string, _since: number, handler: StreamEventHandler) => {
        streamTurn(handler, "Some progress", "tool_use");
        handler.onEvent(
          evt(EventType.Error, { code: "model_error", message: "the model exploded" }),
        );
      },
    );

    const { result } = renderHook(() =>
      useSubagentChatStream(childRunId, "tool-1", true),
    );
    await act(async () => {});

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("the model exploded");
  });
});

describe("reconcileOptimisticUserEchoes", () => {
  const userEcho = (content: string, ts = 1): DisplaySessionEvent =>
    ({
      id: `subagent-user-${ts}`,
      clientId: `subagent-user-${ts}`,
      role: "user",
      content,
    }) as DisplaySessionEvent;

  const recorded = (id: string, role: string, content: string): DisplaySessionEvent =>
    ({ id, clientId: id, role, content }) as DisplaySessionEvent;

  it("returns the authoritative list unchanged when there are no echoes", () => {
    const authoritative = [recorded("evt-1", "assistant", "hi")];
    expect(reconcileOptimisticUserEchoes(authoritative, [])).toBe(authoritative);
  });

  it("drops an echo the recorded transcript already represents", () => {
    const authoritative = [
      recorded("u-1", "user", "do the thing"),
      recorded("a-1", "assistant", "done"),
    ];
    const prev = [...authoritative, userEcho("do the thing")];

    const result = reconcileOptimisticUserEchoes(authoritative, prev);

    expect(result).toBe(authoritative);
    expect(result.filter((e) => e.role === "user")).toHaveLength(1);
  });

  it("preserves an echo that has not been persisted yet", () => {
    const authoritative = [recorded("u-1", "user", "earlier message")];
    const pending = userEcho("not yet saved", 99);

    const result = reconcileOptimisticUserEchoes(authoritative, [
      ...authoritative,
      pending,
    ]);

    expect(result).toHaveLength(2);
    expect(result[result.length - 1]).toMatchObject({ content: "not yet saved" });
  });

  it("reconciles repeated identical messages one-for-one", () => {
    // Two echoes of the same text, but only one recorded turn so far.
    const authoritative = [recorded("u-1", "user", "again")];
    const prev = [authoritative[0], userEcho("again", 1), userEcho("again", 2)];

    const result = reconcileOptimisticUserEchoes(authoritative, prev);

    // One echo reconciled away, one still pending.
    expect(result.filter((e) => e.role === "user")).toHaveLength(2);
  });
});
