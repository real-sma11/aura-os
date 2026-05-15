import { renderHook, act } from "@testing-library/react";
import {
  useStreamStore,
  streamMetaMap,
  ensureEntry,
  createSetters,
} from "./store";
import { formatCountdown, useGenerationEta } from "./use-generation-eta";

describe("useGenerationEta", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no generation is in flight on the entry", () => {
    ensureEntry("k1");
    const { result } = renderHook(() => useGenerationEta("k1"));
    expect(result.current).toBeNull();
  });

  it("seeds the per-model fallback estimate before any percent lands", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gpt-image-2",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));

    // gpt-image-2 -> 120_000ms fallback. At t=0 we expect ~120s remaining.
    expect(result.current).not.toBeNull();
    expect(result.current?.kind).toBe("image");
    expect(result.current?.overrun).toBe(false);
    expect(result.current?.remainingMs).toBe(120_000);
  });

  it("counts down via the 1s ticker while no percent updates land", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "dall-e-3",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    // dall-e-3 baseline: 20_000ms.
    expect(result.current?.remainingMs).toBe(20_000);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current?.remainingMs).toBe(15_000);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current?.remainingMs).toBe(5_000);
  });

  it("falls back to the default estimate when the model id is unknown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "no-such-model",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    expect(result.current?.remainingMs).toBe(30_000);
  });

  it("ratchets the projection down when the adaptive estimate points to a sooner completion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gpt-image-2",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));

    // After 10s elapsed, percent=20 -> total = 10s * 100 / 20 = 50s,
    // sooner than the 120s baseline so the latch ratchets to 50s and
    // remaining = 40s.
    act(() => {
      vi.advanceTimersByTime(10_000);
      setters.setGenerationPercent(20);
    });
    expect(result.current?.remainingMs).toBe(40_000);

    // Sub-threshold percent values can't push the projection back
    // out — the latch stays at the sooner completion, and the
    // countdown keeps ticking naturally.
    act(() => {
      setters.setGenerationPercent(2);
    });
    expect(result.current?.remainingMs).toBe(40_000);
  });

  it("never lets the countdown jump upward when a later adaptive estimate lands", () => {
    // Regression for the original "1:13 on a 60s gpt-image-2"
    // symptom: early `generation_progress.percent` frames can
    // project a total that exceeds the per-model baseline.
    // Without the monotonic latch the displayed digits would
    // bounce upward mid-render. With the latch, a later
    // projection is ignored and the countdown only ticks
    // downward.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gpt-image-2",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    // Baseline seeds the latch at 120s remaining (gpt-image-2).
    expect(result.current?.remainingMs).toBe(120_000);

    // 10s in, a noisy percent=7 would project total ≈ 142.9s,
    // clearly slower than the 120s baseline. The latch must
    // reject it and continue counting against the baseline-derived
    // completion timestamp (110s remaining at t=10s).
    act(() => {
      vi.advanceTimersByTime(10_000);
      setters.setGenerationPercent(7);
    });
    expect(result.current?.remainingMs).toBe(110_000);

    // 5s later, percent=10 projects total = 150s, even further
    // past the latched baseline. Still ignored.
    act(() => {
      vi.advanceTimersByTime(5_000);
      setters.setGenerationPercent(10);
    });
    expect(result.current?.remainingMs).toBe(105_000);

    // Finally percent=40 lands and projects total = 37.5s, which
    // beats the latched 120s baseline at t=15s -> 22.5s remaining.
    // The latch ratchets down and the digits jump (downward, which
    // is the only direction we allow).
    act(() => {
      setters.setGenerationPercent(40);
    });
    expect(result.current?.remainingMs).toBe(22_500);
  });

  it("resets the latch when a new generation run starts on the same entry", () => {
    // Without resetting on `startedAt` change, a quick second
    // send (e.g. user retries an image) would inherit the
    // previous run's latched completion timestamp and read as
    // overrun the moment the new countdown mounted.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "dall-e-3",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));

    // Burn the first run down to overrun.
    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    expect(result.current?.overrun).toBe(true);

    // Start a brand-new run on the same key. The latch must seed
    // from the new baseline, not stay stuck at the previous
    // completion timestamp.
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "dall-e-3",
        kind: "image",
      });
    });
    expect(result.current?.overrun).toBe(false);
    expect(result.current?.remainingMs).toBe(20_000);
  });

  it("flags overrun once the estimate has elapsed but generation has not cleared", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "dall-e-2",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    // dall-e-2 baseline: 12_000ms.
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current?.overrun).toBe(true);
    expect(result.current?.remainingMs).toBe(0);
  });

  it("returns null after clearGeneration runs (terminal events)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gpt-image-1",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    expect(result.current).not.toBeNull();

    act(() => {
      setters.clearGeneration();
    });
    expect(result.current).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("formats sub-minute durations as 0:ss with leading zero", () => {
    expect(formatCountdown(42_000)).toBe("0:42");
    expect(formatCountdown(5_000)).toBe("0:05");
  });

  it("rounds up partial seconds so the digit stays visible for its full second", () => {
    // 100ms left should still read 0:01, not flash 0:00.
    expect(formatCountdown(100)).toBe("0:01");
    expect(formatCountdown(999)).toBe("0:01");
  });

  it("formats multi-minute durations as m:ss", () => {
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(125_000)).toBe("2:05");
  });

  it("clamps negative values to 0:00", () => {
    expect(formatCountdown(-500)).toBe("0:00");
  });
});
