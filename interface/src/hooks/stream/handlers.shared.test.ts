vi.mock("../../api/client", () => ({
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => false),
  isHarnessCapacityExhaustedError: vi.fn(() => null),
  dispatchInsufficientCredits: vi.fn(),
}));

vi.mock("../../utils/chat-history", () => ({
  extractToolCalls: vi.fn(() => []),
  extractArtifactRefs: vi.fn(() => []),
}));

import {
  snapshotThinking,
  snapshotToolCalls,
  snapshotTimeline,
  resetStreamBuffers,
} from "./handlers";
import {
  syncDisplayedTimeline,
  flushStreamingText,
} from "./handlers/shared";
import type { TimelineItem, ToolCallEntry } from "../../shared/types/stream";
import { makeRefs, makeSetters } from "./handlers.test-helpers";

describe("stream/handlers — shared snapshots and reset", () => {
  let origRAF: typeof requestAnimationFrame;
  let nextRafId = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    nextRafId = 1;
    origRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return nextRafId++;
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRAF;
    vi.useRealTimers();
  });

  describe("snapshotThinking", () => {
    it("returns undefined when no thinking", () => {
      const refs = makeRefs();
      const snap = snapshotThinking(refs);
      expect(snap.savedThinking).toBeUndefined();
      expect(snap.savedThinkingDuration).toBeNull();
    });

    it("returns thinking text and duration", () => {
      const refs = makeRefs();
      refs.thinkingBuffer.current = "thinking...";
      refs.thinkingStart.current = Date.now() - 1000;

      const snap = snapshotThinking(refs);
      expect(snap.savedThinking).toBe("thinking...");
      expect(snap.savedThinkingDuration).toBeGreaterThanOrEqual(900);
    });
  });

  describe("snapshotToolCalls", () => {
    it("returns undefined when no tool calls", () => {
      const refs = makeRefs();
      expect(snapshotToolCalls(refs)).toBeUndefined();
    });

    it("returns a copy of tool calls", () => {
      const refs = makeRefs();
      const tc: ToolCallEntry = { id: "tc1", name: "test", input: {}, pending: false };
      refs.toolCalls.current = [tc];

      const snap = snapshotToolCalls(refs)!;
      expect(snap).toHaveLength(1);
      expect(snap[0].id).toBe("tc1");
      expect(snap).not.toBe(refs.toolCalls.current);
    });
  });

  describe("snapshotTimeline", () => {
    it("returns undefined when empty", () => {
      const refs = makeRefs();
      expect(snapshotTimeline(refs)).toBeUndefined();
    });

    it("returns a copy of timeline", () => {
      const refs = makeRefs();
      refs.timeline.current = [{ kind: "thinking", id: "t1" }];

      const snap = snapshotTimeline(refs)!;
      expect(snap).toHaveLength(1);
      expect(snap).not.toBe(refs.timeline.current);
    });
  });

  describe("resetStreamBuffers", () => {
    it("clears all refs and calls all setters", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "text";
      refs.thinkingBuffer.current = "thinking";
      refs.thinkingStart.current = Date.now();
      refs.toolCalls.current = [{ id: "tc", name: "n", input: {}, pending: true }];
      refs.timeline.current = [{ kind: "thinking", id: "t1" }];

      const setters = makeSetters();
      resetStreamBuffers(refs, setters);

      expect(refs.streamBuffer.current).toBe("");
      expect(refs.thinkingBuffer.current).toBe("");
      expect(refs.thinkingStart.current).toBeNull();
      expect(refs.toolCalls.current).toEqual([]);
      expect(refs.timeline.current).toEqual([]);
      expect(setters.calls.setStreamingText).toBeDefined();
      expect(setters.calls.setThinkingText).toBeDefined();
    });
  });

  describe("syncDisplayedTimeline — text/tool ordering", () => {
    function lastPublishedTimeline(
      setters: ReturnType<typeof makeSetters>,
    ): TimelineItem[] {
      const writes = setters.calls.setTimeline;
      expect(writes).toBeDefined();
      expect(writes!.length).toBeGreaterThan(0);
      return writes![writes!.length - 1] as TimelineItem[];
    }

    it("holds back trailing tool cards while the preceding text is still revealing", () => {
      // Models the exact bug: the server has already moved on to the next
      // tool call but the client's word-reveal hasn't caught up to the
      // streamed sentence yet, so the projected timeline must NOT include
      // the trailing tool card under a partially-revealed paragraph.
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "hello world";
      refs.displayedTextLength.current = 3;
      refs.timeline.current = [
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "text", content: "hello world", id: "tl-2" },
        { kind: "tool", toolCallId: "b", id: "tl-3" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "text", content: "hel", id: "tl-2" },
      ]);
    });

    it("publishes the deferred tool card once flushStreamingText reveals the buffer", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "hello world";
      refs.displayedTextLength.current = 3;
      refs.timeline.current = [
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "text", content: "hello world", id: "tl-2" },
        { kind: "tool", toolCallId: "b", id: "tl-3" },
      ];

      flushStreamingText(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "text", content: "hello world", id: "tl-2" },
        { kind: "tool", toolCallId: "b", id: "tl-3" },
      ]);
    });

    it("only gates items after the unrevealed text segment, not items before it", () => {
      // Earlier in the same turn: text "a" finished, tool A landed, then a
      // second text "b" started streaming and a second tool B was queued.
      // The first text + tool A must still show; only "b"'s tool is held.
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "ab";
      refs.displayedTextLength.current = 1;
      refs.timeline.current = [
        { kind: "text", content: "a", id: "tl-1" },
        { kind: "tool", toolCallId: "a", id: "tl-2" },
        { kind: "text", content: "b", id: "tl-3" },
        { kind: "tool", toolCallId: "b", id: "tl-4" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "text", content: "a", id: "tl-1" },
        { kind: "tool", toolCallId: "a", id: "tl-2" },
      ]);
    });

    it("defers a thinking card that arrives after partially-revealed text", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "hello";
      refs.displayedTextLength.current = 2;
      refs.timeline.current = [
        { kind: "text", content: "hello", id: "tl-1" },
        { kind: "thinking", id: "tl-2", text: "later thought" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "text", content: "he", id: "tl-1" },
      ]);
    });

    it("publishes trailing items immediately when there is no preceding text", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "";
      refs.displayedTextLength.current = 0;
      refs.timeline.current = [
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "tool", toolCallId: "b", id: "tl-2" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "tool", toolCallId: "b", id: "tl-2" },
      ]);
    });
  });
});
