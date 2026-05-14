import { renderHook, act } from "@testing-library/react";
import {
  useStreamStore,
  streamMetaMap,
  ensureEntry,
  createSetters,
} from "./store";
import {
  useStreamHealth,
  STUCK_THRESHOLD_MS,
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
