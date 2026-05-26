import { act, renderHook } from "@testing-library/react";
import { useOverlayScrollbar } from "./use-overlay-scrollbar";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalResizeObserver = global.ResizeObserver;

function createScrollContainer({
  clientHeight,
  scrollHeight,
  scrollTop = 0,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop?: number;
}) {
  const wrapper = document.createElement("div");
  const element = document.createElement("div");
  wrapper.appendChild(element);
  let currentScrollTop = scrollTop;

  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => currentScrollTop,
    set: (value: number) => {
      currentScrollTop = value;
    },
  });

  return { element, wrapper };
}

describe("useOverlayScrollbar", () => {
  beforeAll(() => {
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
  });

  it("shows only while hovered when the container overflows", () => {
    const { element, wrapper } = createScrollContainer({ clientHeight: 100, scrollHeight: 300 });
    const containerRef = { current: element };
    const { result } = renderHook(() => useOverlayScrollbar(containerRef));

    expect(result.current.visible).toBe(false);

    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseenter"));
    });

    expect(result.current.visible).toBe(true);

    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseleave"));
    });

    expect(result.current.visible).toBe(false);
  });

  it("stays hidden when the container does not overflow", () => {
    const { element, wrapper } = createScrollContainer({ clientHeight: 100, scrollHeight: 100 });
    const containerRef = { current: element };
    const { result } = renderHook(() => useOverlayScrollbar(containerRef));

    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseenter"));
      element.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.visible).toBe(false);
  });

  it("does not become visible from scrolling alone when not hovered", () => {
    const { element } = createScrollContainer({ clientHeight: 100, scrollHeight: 300, scrollTop: 24 });
    const containerRef = { current: element };
    const { result } = renderHook(() => useOverlayScrollbar(containerRef));

    act(() => {
      element.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.visible).toBe(false);
  });

  it("keeps hovered=true when the cursor crosses onto a sibling thumb inside the wrapper", () => {
    const { element, wrapper } = createScrollContainer({ clientHeight: 100, scrollHeight: 300 });
    const thumb = document.createElement("div");
    wrapper.appendChild(thumb);
    const containerRef = { current: element };
    const { result } = renderHook(() => useOverlayScrollbar(containerRef));

    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseenter"));
    });
    expect(result.current.visible).toBe(true);

    // Cursor moves from the scroll container onto the thumb. With hover
    // tracked on the wrapper, this should NOT fire `mouseleave` on the
    // wrapper, so visibility stays true and no flicker loop starts.
    act(() => {
      element.dispatchEvent(new MouseEvent("mouseleave"));
    });
    expect(result.current.visible).toBe(true);
  });
});
