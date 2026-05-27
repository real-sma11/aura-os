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
});

afterEach(() => {
  (global as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    originalResizeObserver;
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

  it("re-measures when an observer entry fires after a sibling resize", () => {
    const scroller = document.createElement("div");
    const sibling = document.createElement("div");
    const wrapper = document.createElement("div");
    scroller.appendChild(sibling);
    scroller.appendChild(wrapper);
    document.body.appendChild(scroller);

    stubRect(scroller, 0, 500);
    stubRect(sibling, 0, 80);
    stubRect(wrapper, 80, 200);
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });

    const wrapperRef = { current: wrapper };
    const scrollRef = { current: scroller };
    const { result } = renderHook(() => useScrollMargin(wrapperRef, scrollRef));

    expect(result.current).toBe(80);

    // The sibling grew (e.g. a Build Verification step landed). The
    // observer fires for the sibling element; the hook re-measures and
    // notices the wrapper now sits lower in the scroll content.
    stubRect(sibling, 0, 200);
    stubRect(wrapper, 200, 200);
    fireResize();

    expect(result.current).toBe(200);
  });

  it("observes every previous sibling of the wrapper so growth above shifts the margin", () => {
    const scroller = document.createElement("div");
    const a = document.createElement("div");
    const b = document.createElement("div");
    const c = document.createElement("div");
    const wrapper = document.createElement("div");
    scroller.appendChild(a);
    scroller.appendChild(b);
    scroller.appendChild(c);
    scroller.appendChild(wrapper);
    document.body.appendChild(scroller);

    stubRect(scroller, 0, 500);
    stubRect(wrapper, 60, 200);
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });

    const wrapperRef = { current: wrapper };
    const scrollRef = { current: scroller };
    renderHook(() => useScrollMargin(wrapperRef, scrollRef));

    // The single created observer should be tracking the wrapper, the
    // scroller, and all three previous siblings.
    expect(observers).toHaveLength(1);
    const observed = observers[0].observed;
    expect(observed.has(wrapper)).toBe(true);
    expect(observed.has(scroller)).toBe(true);
    expect(observed.has(a)).toBe(true);
    expect(observed.has(b)).toBe(true);
    expect(observed.has(c)).toBe(true);
  });
});
