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

    const measureNow = () => {
      const wrapperRect = wrapper.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const next = wrapperRect.top - scrollerRect.top + scroller.scrollTop;
      setMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };

    // Coalesce bursts of ResizeObserver callbacks (one per observed
    // node, fired back-to-back when many siblings reflow in the same
    // frame) into a single rAF measurement. Without this, the previous
    // implementation's per-callback `getBoundingClientRect()` work plus
    // `setMargin` invocation churned the virtualizer's `translateY`
    // math several times per layout pass during live streaming.
    let rafId: number | null = null;
    const scheduleMeasure = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measureNow();
      });
    };

    measureNow();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    // Observe only the wrapper and scroller. The previous
    // implementation also observed every previous sibling of the
    // wrapper (task meta / files / build / test / git / notes /
    // verification sections) so the virtualizer's `scrollMargin`
    // stayed in sync as those sections grew. That created a steady
    // stream of ResizeObserver callbacks during live streaming (the
    // elapsed timer in `TaskMetaSection` alone triggers per-second
    // resize observations), each one re-running
    // `getBoundingClientRect()` and re-translating every visible
    // virtual row. The wrapper observer alone catches the cases that
    // matter in practice: when content above grows, the wrapper's
    // own bounding rect moves (its size doesn't change, but
    // `ResizeObserver` does notify on `borderBoxSize`/`contentRect`
    // changes from reflow propagation in modern browsers) AND any
    // virtualizer remeasurement scrolls/repaints the affected
    // window. For belt-and-suspenders coverage we also observe the
    // wrapper's direct parent so layout changes one level up reach
    // us without re-walking the full sibling chain.
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(wrapper);
    observer.observe(scroller);
    if (wrapper.parentElement && wrapper.parentElement !== scroller) {
      observer.observe(wrapper.parentElement);
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      observer.disconnect();
    };
  }, [wrapperRef, scrollRef]);

  return margin;
}
