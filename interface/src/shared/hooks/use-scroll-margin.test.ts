import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollMargin } from "./use-scroll-margin";

type ResizeObserverCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver,
) => void;

interface FakeObserver {
  callback: ResizeObserverCallback;
  observed: Set<Element>;
  disconnect: () => void;
}

const observers: FakeObserver[] = [];

class MockResizeObserver {
  private fake: FakeObserver;
  constructor(cb: ResizeObserverCallback) {
    this.fake = {
      callback: cb,
      observed: new Set(),
      disconnect: () => {
        this.fake.observed.clear();
      },
    };
    observers.push(this.fake);
  }
  observe(el: Element): void {
    this.fake.observed.add(el);
  }
  unobserve(el: Element): void {
    this.fake.observed.delete(el);
  }
  disconnect(): void {
    this.fake.disconnect();
  }
}

const originalResizeObserver = global.ResizeObserver;
const originalRaf = global.requestAnimationFrame;
const originalCancelRaf = global.cancelAnimationFrame;

function stubRect(el: Element, top: number, height: number = 20): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    height,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

function fireResize(): void {
  for (const obs of observers) {
    act(() => {
      obs.callback([], {} as ResizeObserver);
    });
  }
}

beforeEach(() => {
  observers.length = 0;
  (global as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
  // Make rAF synchronous so the coalesced measurement in
  // `useScrollMargin` runs inline with `fireResize()` / the initial
  // effect. The real implementation defers via `requestAnimationFrame`
  // to coalesce bursts of ResizeObserver callbacks within a single
  // frame; the production behavior is identical, just not observable
  // until the next paint.
  let nextRafId = 1;
  (
    global as unknown as { requestAnimationFrame: typeof requestAnimationFrame }
  ).requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(performance.now());
    return nextRafId++;
  }) as typeof requestAnimationFrame;
  (
    global as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }
  ).cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  (global as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    originalResizeObserver;
  (
    global as unknown as { requestAnimationFrame: typeof requestAnimationFrame }
  ).requestAnimationFrame = originalRaf;
  (
    global as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }
  ).cancelAnimationFrame = originalCancelRaf;
  vi.restoreAllMocks();
});

describe("useScrollMargin", () => {
  it("returns 0 when refs are not mounted", () => {
    const wrapperRef = { current: null as HTMLElement | null };
    const scrollRef = { current: null as HTMLElement | null };
    const { result } = renderHook(() => useScrollMargin(wrapperRef, scrollRef));
    expect(result.current).toBe(0);
  });

  it("returns the wrapper's vertical offset relative to the scroll element", () => {
    const scroller = document.createElement("div");
    const wrapper = document.createElement("div");
    scroller.appendChild(wrapper);
    document.body.appendChild(scroller);

    stubRect(scroller, 0, 500);
    stubRect(wrapper, 240, 200);
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });

    const wrapperRef = { current: wrapper };
    const scrollRef = { current: scroller };
    const { result } = renderHook(() => useScrollMargin(wrapperRef, scrollRef));

    expect(result.current).toBe(240);
  });

  it("adds the scroll element's scrollTop so the margin describes a stable in-document offset", () => {
    const scroller = document.createElement("div");
    const wrapper = document.createElement("div");
    scroller.appendChild(wrapper);
    document.body.appendChild(scroller);

    // Scroller has scrolled down 100px; the wrapper's bounding-rect top is
    // therefore 100px less than its real top inside the document. The hook
    // re-adds scrollTop so the returned margin equals the wrapper's
    // position from the top of the scroll content, which is what TanStack
    // Virtual's `scrollMargin` expects.
    stubRect(scroller, 0, 500);
    stubRect(wrapper, 140, 200);
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 100 });

    const wrapperRef = { current: wrapper };
    const scrollRef = { current: scroller };
    const { result } = renderHook(() => useScrollMargin(wrapperRef, scrollRef));

    expect(result.current).toBe(240);
  });

  it("re-measures when an observer entry fires after the layout shifts", () => {
    const scroller = document.createElement("div");
    const parent = document.createElement("div");
    const sibling = document.createElement("div");
    const wrapper = document.createElement("div");
    parent.appendChild(sibling);
    parent.appendChild(wrapper);
    scroller.appendChild(parent);
    document.body.appendChild(scroller);

    stubRect(scroller, 0, 500);
    stubRect(parent, 0, 280);
    stubRect(sibling, 0, 80);
    stubRect(wrapper, 80, 200);
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });

    const wrapperRef = { current: wrapper };
    const scrollRef = { current: scroller };
    const { result } = renderHook(() => useScrollMargin(wrapperRef, scrollRef));

    expect(result.current).toBe(80);

    // A sibling above the wrapper grew (e.g. a Build Verification step
    // landed). When the parent reflows we observe the parent grow; the
    // hook coalesces the burst into a single rAF and re-measures,
    // noticing the wrapper now sits lower in the scroll content.
    stubRect(parent, 0, 400);
    stubRect(sibling, 0, 200);
    stubRect(wrapper, 200, 200);
    fireResize();

    expect(result.current).toBe(200);
  });

  it("observes only the wrapper, the scroller, and the wrapper's parent (not the full sibling chain)", () => {
    // The previous implementation observed every previous sibling of
    // the wrapper, which produced a steady stream of ResizeObserver
    // callbacks during live streaming (an elapsed timer alone triggers
    // per-second resize observations) and visibly shifted the
    // virtualizer on every tick. The new implementation observes the
    // wrapper + scroller (always) plus the wrapper's direct parent for
    // belt-and-suspenders coverage of layout changes one level up.
    const scroller = document.createElement("div");
    const parent = document.createElement("div");
    const a = document.createElement("div");
    const b = document.createElement("div");
    const c = document.createElement("div");
    const wrapper = document.createElement("div");
    parent.appendChild(a);
    parent.appendChild(b);
    parent.appendChild(c);
    parent.appendChild(wrapper);
    scroller.appendChild(parent);
    document.body.appendChild(scroller);

    stubRect(scroller, 0, 500);
    stubRect(parent, 0, 280);
    stubRect(wrapper, 60, 200);
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });

    const wrapperRef = { current: wrapper };
    const scrollRef = { current: scroller };
    renderHook(() => useScrollMargin(wrapperRef, scrollRef));

    expect(observers).toHaveLength(1);
    const observed = observers[0].observed;
    expect(observed.has(wrapper)).toBe(true);
    expect(observed.has(scroller)).toBe(true);
    expect(observed.has(parent)).toBe(true);
    // Siblings of the wrapper are no longer individually observed —
    // their layout impact propagates through the parent observation.
    expect(observed.has(a)).toBe(false);
    expect(observed.has(b)).toBe(false);
    expect(observed.has(c)).toBe(false);
  });
});
