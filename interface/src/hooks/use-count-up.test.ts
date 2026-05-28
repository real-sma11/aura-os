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

  it("ramps the displayed value from 0 toward the loading target while target is null", () => {
    const { result } = renderHook(() =>
      useCountUp({ target: null, loadingTarget: 1000, loadingRampMs: 2500 }),
    );

    expect(result.current).toBe(0);

    act(() => {
      raf.step(1250);
    });
    expect(result.current).toBeGreaterThan(400);
    expect(result.current).toBeLessThan(600);

    act(() => {
      raf.step(1300);
    });
    expect(result.current).toBe(1000);
  });

  it("rapidly snaps from the loading value to the resolved target", () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) =>
        useCountUp({
          target,
          loadingTarget: 1000,
          loadingRampMs: 2500,
          snapMs: 350,
        }),
      { initialProps: { target: null as number | null } },
    );

    act(() => {
      raf.step(2500);
    });
    expect(result.current).toBe(1000);

    rerender({ target: 42 });
    expect(result.current).toBe(1000);

    act(() => {
      raf.step(175);
    });
    expect(result.current).toBeLessThan(1000);
    expect(result.current).toBeGreaterThan(42);

    act(() => {
      raf.step(200);
    });
    expect(result.current).toBe(42);
  });

  it("snaps to the target without animating when prefers-reduced-motion is set", () => {
    stubMatchMedia(true);
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) =>
        useCountUp({ target }),
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

  it("animates downward when a new lower target arrives", () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) =>
        useCountUp({ target, snapMs: 200 }),
      { initialProps: { target: 5000 as number | null } },
    );

    expect(result.current).toBe(5000);

    rerender({ target: 1000 });
    act(() => {
      raf.step(200);
    });
    expect(result.current).toBe(1000);
  });
});
