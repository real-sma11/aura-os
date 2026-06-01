import { renderHook, act } from "@testing-library/react";
import { EventType, type AuraEvent } from "../shared/types/aura-events";
import type { StreamEventHandler } from "../api/streams";

const mockAttach = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
const mockAttachToStream = vi.hoisted(() => vi.fn());

vi.mock("../shared/api/subagents", () => ({
  subagentsApi: { attach: mockAttach, send: mockSend },
}));

vi.mock(import("../api/streams"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, attachToStream: mockAttachToStream };
});

import { useSubagentChatStream, subagentStreamKey } from "./use-subagent-chat-stream";
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
});
