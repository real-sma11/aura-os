import { useEffect, useState, type RefObject } from "react";

/**
 * Measure the vertical offset of `wrapperRef` relative to the top of
 * `scrollRef`, re-measuring whenever the wrapper, the scroll element, or
 * any previous sibling of the wrapper resizes.
 *
 * Used to compute the `scrollMargin` for `@tanstack/react-virtual` when a
 * virtualized list lives partway down a larger scroll container (e.g. the
 * task preview events list inside `.previewBody`, which is preceded by
 * meta / files / build / test / git / notes sections that grow as the
 * task progresses). Without this, the virtualizer assumes the list starts
 * at the scroll element's top and items render at the wrong vertical
 * positions whenever the surrounding sections aren't empty.
 *
 * Returns `0` until both refs are mounted; safe to pass straight to
 * `useVirtualizer({ scrollMargin })`.
 */
export function useScrollMargin(
  wrapperRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null> | undefined,
): number {
  const [margin, setMargin] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const scroller = scrollRef?.current;
    if (!wrapper || !scroller) {
      // Default state is already 0; avoid a synchronous setState here
      // (the React Compiler / `react-hooks/set-state-in-effect` lint
      // rule flags it as a potential cascade trigger). If refs become
      // null after the first run the last measured value sticks until
      // they remount, which is fine for the virtualizer consumers.
      return;
    }

    const measure = () => {
      const wrapperRect = wrapper.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const next = wrapperRect.top - scrollerRect.top + scroller.scrollTop;
      setMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(wrapper);
    observer.observe(scroller);

    // Sections above the wrapper inside the same scroll container (task
    // meta, files, build / test / git collapsibles, notes) grow as the
    // task progresses. Observing every previous sibling keeps the
    // virtualizer's scrollMargin in sync as those rows reflow.
    const observedSiblings: Element[] = [];
    let sibling: Element | null = wrapper.previousElementSibling;
    while (sibling) {
      observer.observe(sibling);
      observedSiblings.push(sibling);
      sibling = sibling.previousElementSibling;
    }

    return () => {
      observer.disconnect();
    };
  }, [wrapperRef, scrollRef]);

  return margin;
}
