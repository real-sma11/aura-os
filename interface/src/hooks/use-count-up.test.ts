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

  it("ramps toward the loading target while the real target is null", () => {
    const { result } = renderHook(() =>
      useCountUp({
        target: null,
        loadingTarget: 99,
        loadingRampMs: 900,
      }),
    );

    expect(result.current).toBe(0);

    act(() => {
      raf.step(450);
    });
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(99);

    act(() => {
      raf.step(450);
    });
    expect(result.current).toBe(99);
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

  it("counts up from the loading ramp once the target transitions from null to a finite value", () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) =>
        useCountUp({
          target,
          durationMs: 400,
          loadingTarget: 99,
          loadingRampMs: 900,
        }),
      { initialProps: { target: null as number | null } },
    );

    act(() => {
      raf.step(900);
    });
    expect(result.current).toBe(99);

    rerender({ target: 142 });
    expect(result.current).toBe(99);

    act(() => {
      raf.step(200);
    });
    expect(result.current).toBeGreaterThan(99);
    expect(result.current).toBeLessThan(142);

    act(() => {
      raf.step(200);
    });
    expect(result.current).toBe(142);
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

  it("replays from 0 when resetKey changes", () => {
    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useCountUp({ target: 500, durationMs: 400, resetKey }),
      { initialProps: { resetKey: "visit-1" } },
    );

    act(() => {
      raf.step(400);
    });
    expect(result.current).toBe(500);

    rerender({ resetKey: "visit-2" });
    expect(result.current).toBe(0);

    act(() => {
      raf.step(400);
    });
    expect(result.current).toBe(500);
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
