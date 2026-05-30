import { useEffect, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 1200;

export interface UseCountUpOptions {
  /**
   * The final value to count up to. While `null` (data still loading)
   * the displayed value holds at its current position (0 on first
   * paint). As soon as a finite number arrives the displayed value
   * eases from where it is now up to `target`.
   */
  readonly target: number | null;
  /** Duration of the count-up animation. Defaults to 1200ms. */
  readonly durationMs?: number;
}

function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Animated count-up used by the `/changelog` summary card. The displayed
 * value always starts at 0 and eases up to `target` over `durationMs`
 * once a finite number is available — including on cached revisits where
 * the value is already known on mount. While `target` is `null` (query
 * pending) the value holds at 0. Respects `prefers-reduced-motion` by
 * short-circuiting to the final value with no animation.
 */
export function useCountUp({
  target,
  durationMs = DEFAULT_DURATION_MS,
}: UseCountUpOptions): number {
  const [displayed, setDisplayed] = useState<number>(0);
  const displayedRef = useRef<number>(displayed);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    const cancel = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    cancel();

    // Hold the current value while the underlying data is still loading.
    if (target === null) {
      return cancel;
    }

    // Reduced-motion users skip the animation. We still go through a
    // single rAF tick so the state update lands on the next paint
    // instead of cascading synchronously out of the effect body.
    if (prefersReducedMotion()) {
      frameRef.current = window.requestAnimationFrame(() => {
        if (displayedRef.current !== target) {
          setDisplayed(target);
        }
        frameRef.current = null;
      });
      return cancel;
    }

    const startValue = displayedRef.current;
    const delta = target - startValue;
    if (delta === 0) {
      return cancel;
    }
    const startTime = performance.now();

    const step = (timestamp: number) => {
      const linear = Math.min(1, (timestamp - startTime) / durationMs);
      const eased = easeOutCubic(linear);
      const next = Math.round(startValue + delta * eased);
      if (next !== displayedRef.current) {
        setDisplayed(next);
      }
      if (linear < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        if (displayedRef.current !== target) {
          setDisplayed(target);
        }
        frameRef.current = null;
      }
    };
    frameRef.current = window.requestAnimationFrame(step);
    return cancel;
  }, [target, durationMs]);

  return displayed;
}
