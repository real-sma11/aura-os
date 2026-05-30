import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountUp } from "./use-count-up";

interface FakeRafController {
  step: (advanceMs: number) => void;
  reset: () => void;
}

function installFakeRaf(): FakeRafController {
  let now = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;

  const performanceMock = { now: () => now };
  vi.stubGlobal("performance", performanceMock as unknown as Performance);

  const requestAnimationFrame = vi.fn((cb: FrameRequestCallback): number => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  const cancelAnimationFrame = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

  return {
    step(advanceMs: number) {
      now += advanceMs;
      const queued = Array.from(callbacks.entries());
      callbacks.clear();
      for (const [, cb] of queued) {
        cb(now);
      }
    },
    reset() {
      now = 0;
      callbacks.clear();
      nextId = 1;
    },
  };
}

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    } satisfies Partial<MediaQueryList> as unknown as MediaQueryList),
  );
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: globalThis.matchMedia,
  });
}

describe("useCountUp", () => {
  let raf: FakeRafController;

  beforeEach(() => {
    raf = installFakeRaf();
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    raf.reset();
  });

  it("holds at 0 while the target is null", () => {
    const { result } = renderHook(() => useCountUp({ target: null }));

    expect(result.current).toBe(0);

    act(() => {
      raf.step(1000);
    });
    expect(result.current).toBe(0);
  });

  it("eases the displayed value from 0 up to the target over durationMs", () => {
    const { result } = renderHook(() =>
      useCountUp({ target: 1000, durationMs: 1200 }),
    );

    expect(result.current).toBe(0);

    act(() => {
      raf.step(600);
    });
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(1000);

    act(() => {
      raf.step(600);
    });
    expect(result.current).toBe(1000);
  });

  it("counts up from 0 once the target transitions from null to a finite value", () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) =>
        useCountUp({ target, durationMs: 400 }),
      { initialProps: { target: null as number | null } },
    );

    act(() => {
      raf.step(1000);
    });
    expect(result.current).toBe(0);

    rerender({ target: 42 });
    expect(result.current).toBe(0);

    act(() => {
      raf.step(200);
    });
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(42);

    act(() => {
      raf.step(200);
    });
    expect(result.current).toBe(42);
  });

  it("animates from 0 even when the target is already known on mount (cached load)", () => {
    const { result } = renderHook(() =>
      useCountUp({ target: 6120, durationMs: 400 }),
    );

    expect(result.current).toBe(0);

    act(() => {
      raf.step(400);
    });
    expect(result.current).toBe(6120);
  });

  it("snaps to the target without animating when prefers-reduced-motion is set", () => {
    stubMatchMedia(true);
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) => useCountUp({ target }),
      { initialProps: { target: null as number | null } },
    );

    expect(result.current).toBe(0);

    rerender({ target: 1234 });
    // Reduced-motion path defers the single setState to a rAF callback
    // so it doesn't synchronously cascade out of the effect. A single
    // frame tick is enough to observe the resolved value.
    act(() => {
      raf.step(16);
    });
    expect(result.current).toBe(1234);
  });
});
