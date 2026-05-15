import { renderHook, act } from "@testing-library/react";
import {
  useStreamStore,
  streamMetaMap,
  ensureEntry,
  createSetters,
  markStreamProgress,
} from "./store";
import {
  useStreamHealth,
  useStuckStreamAutoTimeout,
  STUCK_THRESHOLD_MS,
  FULLY_TIMED_OUT_MS,
} from "./use-stream-health";

describe("useStreamHealth", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports not stuck when stream is idle", () => {
    ensureEntry("k1");
    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isStuck).toBe(false);
    expect(result.current.lastEventAgeMs).toBeNull();
    expect(result.current.stuckForMs).toBeNull();
  });

  it("reports not stuck while events are landing within the threshold", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("hello");

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.lastEventAgeMs).toBe(0);
    expect(result.current.isStuck).toBe(false);

    // Advance 5s — well below the 30s threshold.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.isStuck).toBe(false);
    expect(result.current.lastEventAgeMs).toBe(5_000);
  });

  it("flips to stuck after the threshold elapses without a fresh event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("hello");

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStuck).toBe(false);

    // Push past the stuck threshold. The interval ticker is what
    // forces the re-render even though no setter ran during the gap.
    act(() => {
      vi.advanceTimersByTime(STUCK_THRESHOLD_MS + 1_000);
    });

    expect(result.current.isStuck).toBe(true);
    expect(result.current.lastEventAgeMs).toBeGreaterThanOrEqual(
      STUCK_THRESHOLD_MS,
    );
    expect(result.current.stuckForMs).toBeGreaterThanOrEqual(0);
  });

  it("clears stuck status when a fresh event arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("hello");

    const { result } = renderHook(() => useStreamHealth("k1"));

    act(() => {
      vi.advanceTimersByTime(STUCK_THRESHOLD_MS + 5_000);
    });
    expect(result.current.isStuck).toBe(true);

    // A new wire event should reset the clock.
    act(() => {
      setters.setStreamingText("hello world");
    });
    expect(result.current.isStuck).toBe(false);
    expect(result.current.lastEventAgeMs).toBe(0);
  });

  it("re-renders periodically while streaming so age advances without setter activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.lastEventAgeMs).toBe(0);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.lastEventAgeMs).toBe(2_000);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.lastEventAgeMs).toBe(5_000);
  });

  it("stops ticking after streaming ends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      setters.setIsStreaming(false);
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.lastEventAgeMs).toBeNull();
    expect(result.current.isStuck).toBe(false);
  });
});

describe("useStuckStreamAutoTimeout", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes onAutoTimeout exactly once when the stuck window crosses FULLY_TIMED_OUT_MS", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    // Below the timeout — no fire yet.
    act(() => {
      vi.advanceTimersByTime(STUCK_THRESHOLD_MS + 5_000);
    });
    expect(onAutoTimeout).not.toHaveBeenCalled();

    // Cross the 60s wall-clock threshold.
    act(() => {
      vi.advanceTimersByTime(FULLY_TIMED_OUT_MS - (STUCK_THRESHOLD_MS + 5_000) + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);

    // Subsequent ticks within the same stuck episode must not re-fire.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a fresh wire event so a second stuck episode also fires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    act(() => {
      vi.advanceTimersByTime(FULLY_TIMED_OUT_MS + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);

    // Fresh wire event resets the clock, then go silent again past
    // the 60s threshold.
    act(() => {
      setters.setStreamingText("seed-2");
    });
    act(() => {
      vi.advanceTimersByTime(FULLY_TIMED_OUT_MS + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(2);
  });

  it("treats markStreamProgress as a wire event so partial-image-only streams do not auto-timeout", () => {
    // Regression guard for the GPT Image 2 watchdog timeout: the
    // chat-stream handlers no-op'd on `generation_partial_image`,
    // letting the 60s `useStuckStreamAutoTimeout` auto-abort a long
    // partial-image render whose `progress` events were sparser than
    // the 60s window. The handler now calls `markStreamProgress` on
    // each partial-image frame; this test pins that contract by
    // asserting the watchdog stays quiet when ONLY `markStreamProgress`
    // ticks land between the seed event and the would-be timeout.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    // Walk past the 60s window in 30s slices, acking each slice with
    // a `markStreamProgress` (i.e. a partial-image SSE event arrived
    // but no setter ran). Two ticks adds up to 60s of wall-clock —
    // strictly more than `FULLY_TIMED_OUT_MS` — yet the watchdog must
    // stay silent because the wire-event clock keeps resetting.
    for (let slice = 0; slice < 4; slice += 1) {
      act(() => {
        vi.advanceTimersByTime(30_000);
        markStreamProgress("k1");
      });
    }
    expect(onAutoTimeout).not.toHaveBeenCalled();

    // Sanity-check the inverse: stop ticking the wire-event clock and
    // the watchdog still fires after 60s. This guarantees the test
    // above didn't pass for some unrelated reason (e.g. the watchdog
    // being globally disabled).
    act(() => {
      vi.advanceTimersByTime(FULLY_TIMED_OUT_MS + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not fire when streaming ends before the timeout elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    act(() => {
      vi.advanceTimersByTime(STUCK_THRESHOLD_MS + 5_000);
    });
    act(() => {
      setters.setIsStreaming(false);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onAutoTimeout).not.toHaveBeenCalled();
  });
});
