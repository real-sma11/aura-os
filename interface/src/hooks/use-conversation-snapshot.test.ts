import { renderHook } from "@testing-library/react";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { useMessageStore } from "../stores/message-store";
import { createSetters, streamMetaMap, useStreamStore } from "./stream/store";
import { useConversationSnapshot } from "./use-conversation-snapshot";

function setStreamMessages(streamKey: string, messages: DisplaySessionEvent[]) {
  useStreamStore.setState((state) => ({
    entries: {
      ...state.entries,
      [streamKey]: {
        isStreaming: false,
        isWriting: false,
        events: [],
        streamingText: "",
        thinkingText: "",
        thinkingDurationMs: null,
        activeToolCalls: [],
        timeline: [],
        progressText: "",
      },
    },
  }));
  createSetters(streamKey).setEvents(messages);
}

function setLiveAssistantText(streamKey: string, streamingText: string) {
  useStreamStore.setState((state) => ({
    entries: {
      ...state.entries,
      [streamKey]: {
        ...(state.entries[streamKey] ?? {
          isStreaming: false,
          isWriting: false,
          events: [],
          thinkingDurationMs: null,
          activeToolCalls: [],
          timeline: [],
          progressText: "",
        }),
        streamingText,
        thinkingText: "",
        isWriting: false,
      },
    },
  }));
}

describe("useConversationSnapshot", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    useMessageStore.setState({ messages: {}, orderedIds: {} });
  });

  it("deduplicates persisted user messages once the saved assistant has anchored the turn", () => {
    const streamKey = "thread-1";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user", role: "user", content: "Testing" },
      { id: "evt-assistant", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "Testing" },
      { id: "evt-assistant", role: "assistant", content: "Meow!" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages,
      }),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("deduplicates persisted assistant messages against stream placeholders", () => {
    const streamKey = "thread-2";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-assistant", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "stream-1", role: "assistant", content: "Meow!" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages,
      }),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("still renders a fresh optimistic bubble when identical content exists earlier in history", () => {
    const streamKey = "thread-3";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-old", role: "user", content: "test" },
      { id: "evt-assistant-old", role: "assistant", content: "prior reply" },
    ];

    const optimisticUser: DisplaySessionEvent = {
      id: "temp-repeat",
      role: "user",
      content: "test",
    };
    setStreamMessages(streamKey, [optimisticUser]);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages,
      }),
    );

    expect(result.current.messages).toEqual([...historyMessages, optimisticUser]);
  });

  it("deduplicates a lone optimistic user when history already has the active assistant tail", () => {
    const streamKey = "thread-live-tail";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "test" },
      {
        id: "evt-assistant-real",
        role: "assistant",
        content: "Hello! It looks like you're just testing things out.",
      },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-repeat", role: "user", content: "test" },
    ]);
    setLiveAssistantText(
      streamKey,
      "Hello! It looks like you're just testing things out.",
    );

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages,
      }),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("keeps a repeated optimistic prompt when the matching history tail is not live", () => {
    const streamKey = "thread-repeat-no-live-tail";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-old", role: "user", content: "test" },
      { id: "evt-assistant-old", role: "assistant", content: "prior reply" },
    ];
    const optimisticUser: DisplaySessionEvent = {
      id: "temp-repeat",
      role: "user",
      content: "test",
    };

    setStreamMessages(streamKey, [optimisticUser]);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages,
      }),
    );

    expect(result.current.messages).toEqual([...historyMessages, optimisticUser]);
  });

  it("anchors the leading optimistic user bubble against history when the assistant content has not converged yet", () => {
    // Regression for the "user prompt remains, all assistant content gone"
    // bug: when the stream still holds [user-temp, asst-stream] and the
    // forced post-stream history fetch returns [user-real, asst-real]
    // whose assistant content is *fuller* than the stream (e.g. because
    // the stream was paused mid-token, or final post-processing replaced
    // it), tail-matching fails on the assistant slot. The back-walk path
    // must still anchor the user at stored[0] so the user message
    // doesn't get duplicated at the bottom while the assistant gets
    // dropped.
    const streamKey = "thread-anchor";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "Hi" },
      { id: "evt-assistant-real", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "Hi" },
      { id: "stream-1", role: "assistant", content: "Meo" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages,
      }),
    );

    expect(result.current.messages.map((m) => m.id)).toEqual([
      "evt-user-real",
      "evt-assistant-real",
      "stream-1",
    ]);
    expect(
      result.current.messages.filter((m) => m.role === "user"),
    ).toHaveLength(1);
  });

  it("aligns [user-temp, asst-stream] with [user-real, asst-real] when assistant content matches", () => {
    const streamKey = "thread-anchor-clean";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "Hi" },
      { id: "evt-assistant-real", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "Hi" },
      { id: "stream-1", role: "assistant", content: "Meow!" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages,
      }),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("dedupes the full turn once the tail of history sequence-matches the stream", () => {
    const streamKey = "thread-4";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-old", role: "user", content: "test" },
      { id: "evt-assistant-old", role: "assistant", content: "prior reply" },
      { id: "evt-user-new", role: "user", content: "test" },
      { id: "evt-assistant-new", role: "assistant", content: "fresh reply" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-repeat", role: "user", content: "test" },
      { id: "stream-reply", role: "assistant", content: "fresh reply" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages,
      }),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("falls back to the last non-empty snapshot when every input briefly empties on the same stream", () => {
    // Regression for the CEO chat blink: a sidebar prefetch evicts the
    // active history entry (`MAX_HISTORY_ENTRIES = 8`), the post-stream
    // "history caught up" effect resets stream events to `[]`, and the
    // `setThread(streamKey, history)` effect hasn't re-run yet because
    // `historyMessages` is also `[]` from the eviction. Without the
    // fallback, the merged result is `[]` and `ChatMessageList` flashes
    // its empty state, dropping the entire transcript for one or two
    // frames mid-turn. The fallback keeps the prior transcript visible
    // until any input repopulates.
    const streamKey = "thread-blink";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user", role: "user", content: "hello" },
      { id: "evt-assistant", role: "assistant", content: "hi there" },
    ];

    const { result, rerender } = renderHook(
      ({ history }: { history: DisplaySessionEvent[] | undefined }) =>
        useConversationSnapshot({
          streamKey,
          transcriptKey: streamKey,
          historyMessages: history,
        }),
      { initialProps: { history: historyMessages } },
    );

    expect(result.current.messages).toEqual(historyMessages);

    // Simulate the eviction + stream reset round-trip: history briefly
    // empties, message-store thread for `streamKey` is intentionally
    // cleared too so the inline `getThreadMessages` read inside
    // `useMemo` cannot rescue the snapshot from the message store.
    useMessageStore.getState().clearThread(streamKey);
    setStreamMessages(streamKey, []);
    rerender({ history: [] });

    expect(result.current.messages).toEqual(historyMessages);

    // Recovery: history refetch lands. The fallback should release back
    // to the live merged result for the new input — verified by passing a
    // distinct payload so we know we're not just returning the cache.
    const recoveredHistory: DisplaySessionEvent[] = [
      ...historyMessages,
      { id: "evt-user-2", role: "user", content: "still here" },
    ];
    rerender({ history: recoveredHistory });

    expect(result.current.messages).toEqual(recoveredHistory);
  });

  it("returns a legitimately-empty thread for a brand-new chat with no prior snapshot", () => {
    // The fallback must NOT invent messages for a chat that has never
    // had any. Initial mount with empty inputs must render as truly empty
    // so the cold-load empty state can show.
    const streamKey = "thread-fresh";

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: streamKey,
        historyMessages: [],
      }),
    );

    expect(result.current.messages).toEqual([]);
  });

  it("does not read a previous transcript when the streamKey stays the same", () => {
    const streamKey = "project-1:agent-1";
    const previousTranscript: DisplaySessionEvent[] = [
      { id: "evt-old-user", role: "user", content: "old session" },
      { id: "evt-old-assistant", role: "assistant", content: "old reply" },
    ];

    useMessageStore.getState().setThread(streamKey, previousTranscript);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey: "session:project-1:agent-1:new-session",
        historyMessages: [],
      }),
    );

    expect(result.current.messages).toEqual([]);
  });

  it("merges live stream messages with the current transcriptKey history", () => {
    const streamKey = "project-1:agent-1";
    const transcriptKey = "session:project-1:agent-1:current";
    const currentTranscript: DisplaySessionEvent[] = [
      { id: "evt-current-user", role: "user", content: "current session" },
      { id: "evt-current-assistant", role: "assistant", content: "current reply" },
    ];
    const liveMessage: DisplaySessionEvent = {
      id: "temp-current",
      role: "user",
      content: "live follow up",
    };

    useMessageStore.getState().setThread(streamKey, [
      { id: "evt-old-user", role: "user", content: "old session" },
    ]);
    useMessageStore.getState().setThread(transcriptKey, currentTranscript);
    setStreamMessages(streamKey, [liveMessage]);

    const { result } = renderHook(() =>
      useConversationSnapshot({
        streamKey,
        transcriptKey,
        historyMessages: [],
      }),
    );

    expect(result.current.messages).toEqual([...currentTranscript, liveMessage]);
  });

  it("does not use the last non-empty cache after a transcriptKey switch", () => {
    const streamKey = "project-1:agent-1";
    const firstHistory: DisplaySessionEvent[] = [
      { id: "evt-user-a", role: "user", content: "first" },
      { id: "evt-assistant-a", role: "assistant", content: "reply A" },
    ];

    const { result, rerender } = renderHook(
      ({
        transcriptKey,
        history,
      }: {
        transcriptKey: string;
        history: DisplaySessionEvent[];
      }) =>
        useConversationSnapshot({
          streamKey,
          transcriptKey,
          historyMessages: history,
        }),
      {
        initialProps: {
          transcriptKey: "session:project-1:agent-1:first",
          history: firstHistory,
        },
      },
    );

    expect(result.current.messages).toEqual(firstHistory);

    useMessageStore
      .getState()
      .clearThread("session:project-1:agent-1:first");
    setStreamMessages(streamKey, []);
    rerender({
      transcriptKey: "session:project-1:agent-1:second",
      history: [],
    });

    expect(result.current.messages).toEqual([]);
  });

  it("reinstates a prior persisted assistant when send drops it from the merge", () => {
    // The "previous answer overwrites for a frame on send, then reappears
    // at end of turn" symptom: after a turn finishes, history+stream
    // converge on `[user-1, asst-1]`. The user clicks Send to start the
    // next turn — a `temp-user-2` lands in the stream — but a flap in
    // any of the merge inputs (history-store entry briefly empty,
    // stream-store events evicted, message-store thread reset) can make
    // the merged result drop `asst-1` for one render. Without the
    // defensive splice, that frame renders `[user-1, user-2-temp]` and
    // ChatMessageList unmounts the prior assistant bubble. The cache-
    // backed reinstate fix observes the optimistic-tail invariant and
    // splices `asst-1` back in.
    const streamKey = "project-1:agent-1:reinstate";
    const transcriptKey = streamKey;
    const settledHistory: DisplaySessionEvent[] = [
      { id: "evt-user-1", role: "user", content: "first prompt" },
      { id: "evt-assistant-1", role: "assistant", content: "first reply" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "first prompt" },
      { id: "evt-assistant-1", role: "assistant", content: "first reply" },
    ]);

    const { result, rerender } = renderHook(
      ({ history }: { history: DisplaySessionEvent[] }) =>
        useConversationSnapshot({
          streamKey,
          transcriptKey,
          historyMessages: history,
        }),
      { initialProps: { history: settledHistory } },
    );

    // Settled state: prior turn fully visible and cached.
    expect(result.current.messages).toEqual(settledHistory);

    // Simulate the bug-trigger frame: a WS-driven force refetch lands
    // a partial snapshot that's missing the prior assistant (e.g.
    // server returned just `[user-1]` because `asst-1` had been pruned
    // from the in-memory cache between the request and the response,
    // or message-store thread was cleared by `invalidateHistory` on
    // an unrelated key collision) AT THE SAME TIME as the user clicks
    // Send and `temp-2` lands in the stream alongside the still-
    // present `temp-1` optimistic from turn 1.
    //
    // With those inputs the merge anchors `temp-1` to the surviving
    // `user-1` in stored (matching role + content) and emits
    // `[user-1, temp-2]`. The prior assistant has vanished from the
    // merged output for this frame even though it was visible just
    // a tick ago.
    useMessageStore
      .getState()
      .setThread(transcriptKey, [
        { id: "evt-user-1", role: "user", content: "first prompt" },
      ]);
    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "first prompt" },
      { id: "temp-2", role: "user", content: "follow-up prompt" },
    ]);
    rerender({
      history: [{ id: "evt-user-1", role: "user", content: "first prompt" }],
    });

    // The defensive splice must reinstate `asst-1` from the cached
    // last-non-empty snapshot, before the trailing optimistic
    // `temp-2`. Without the fix the assistant bubble would unmount for
    // this frame, manifesting as the reported "split-second blank"
    // between the prior reply and the reappearance at end of turn.
    expect(result.current.messages.map((m) => m.id)).toEqual([
      "evt-user-1",
      "evt-assistant-1",
      "temp-2",
    ]);
    expect(result.current.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });

  it("reinstates a prior persisted assistant when the send frame already has an assistant placeholder", () => {
    // Same missing-assistant race as above, but the live stream has already
    // appended the next turn's assistant placeholder after the optimistic
    // user prompt. A tail-only send detector misses this shape because the
    // merged result ends in `stream-asst-2`, not `temp-2`.
    const streamKey = "project-1:agent-1:reinstate-with-placeholder";
    const transcriptKey = streamKey;
    const settledHistory: DisplaySessionEvent[] = [
      { id: "evt-user-1", role: "user", content: "first prompt" },
      { id: "evt-assistant-1", role: "assistant", content: "first reply" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "first prompt" },
      { id: "evt-assistant-1", role: "assistant", content: "first reply" },
    ]);

    const { result, rerender } = renderHook(
      ({ history }: { history: DisplaySessionEvent[] }) =>
        useConversationSnapshot({
          streamKey,
          transcriptKey,
          historyMessages: history,
        }),
      { initialProps: { history: settledHistory } },
    );

    expect(result.current.messages).toEqual(settledHistory);

    useMessageStore
      .getState()
      .setThread(transcriptKey, [
        { id: "evt-user-1", role: "user", content: "first prompt" },
      ]);
    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "first prompt" },
      { id: "temp-2", role: "user", content: "follow-up prompt" },
      { id: "stream-asst-2", role: "assistant", content: "" },
    ]);
    rerender({
      history: [{ id: "evt-user-1", role: "user", content: "first prompt" }],
    });

    expect(result.current.messages.map((m) => m.id)).toEqual([
      "evt-user-1",
      "evt-assistant-1",
      "temp-2",
      "stream-asst-2",
    ]);
    expect(result.current.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("does not reinstate when the merged tail is not an optimistic user prompt", () => {
    // The reinstate path is keyed on a newly optimistic local user
    // message — the canonical Send frame. Idle refreshes (between
    // turns, no user prompt in flight) must trust the merge so legitimate
    // server-side history changes flow through. This test proves a
    // delete-style refresh that drops the prior assistant does NOT get
    // its assistant resurrected, because the trigger condition is absent.
    const streamKey = "project-1:agent-1:idle";
    const transcriptKey = streamKey;
    const settledHistory: DisplaySessionEvent[] = [
      { id: "evt-user-1", role: "user", content: "first prompt" },
      { id: "evt-assistant-1", role: "assistant", content: "first reply" },
    ];

    setStreamMessages(streamKey, settledHistory);

    const { result, rerender } = renderHook(
      ({ history }: { history: DisplaySessionEvent[] }) =>
        useConversationSnapshot({
          streamKey,
          transcriptKey,
          historyMessages: history,
        }),
      { initialProps: { history: settledHistory } },
    );

    expect(result.current.messages).toEqual(settledHistory);

    // Idle refresh: server returns just `user-1`, no in-flight
    // optimistic prompt at the tail. The reinstate path must NOT
    // resurrect `asst-1` here — that would silently undo a legitimate
    // delete / pruning event.
    useMessageStore.getState().clearThread(transcriptKey);
    setStreamMessages(streamKey, [
      { id: "evt-user-1", role: "user", content: "first prompt" },
    ]);
    rerender({
      history: [{ id: "evt-user-1", role: "user", content: "first prompt" }],
    });

    expect(result.current.messages).toEqual([
      { id: "evt-user-1", role: "user", content: "first prompt" },
    ]);
  });

  it("clears the fallback cache when the chat switches to a new streamKey", () => {
    // Switching agents must reset the cache so the new chat's empty
    // initial frame is not papered over by the previous chat's tail.
    const firstHistory: DisplaySessionEvent[] = [
      { id: "evt-user-a", role: "user", content: "first" },
      { id: "evt-assistant-a", role: "assistant", content: "reply A" },
    ];

    const { result, rerender } = renderHook(
      ({ key, history }: { key: string; history: DisplaySessionEvent[] }) =>
        useConversationSnapshot({
          streamKey: key,
          transcriptKey: key,
          historyMessages: history,
        }),
      { initialProps: { key: "thread-a", history: firstHistory } },
    );

    expect(result.current.messages).toEqual(firstHistory);

    rerender({ key: "thread-b", history: [] });

    // The new chat starts empty even though the previous one had content.
    expect(result.current.messages).toEqual([]);
  });
});
