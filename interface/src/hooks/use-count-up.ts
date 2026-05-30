import { useEffect, useRef, useState } from "react";

/**
 * When no explicit `durationMs` is given the animation length is derived
 * from how many integer steps it has to traverse, so small counts still
 * get a perceptible window instead of finishing in a few frames. Each
 * step is paced at `MS_PER_STEP`, clamped between `MIN_DURATION_MS` and
 * `MAX_DURATION_MS`.
 */
const MS_PER_STEP = 80;
const MIN_DURATION_MS = 900;
const MAX_DURATION_MS = 2200;

export interface UseCountUpOptions {
  /**
   * The final value to count up to. While `null` (data still loading)
   * the displayed value holds at its current position (0 on first
   * paint). As soon as a finite number arrives the displayed value
   * eases from where it is now up to `target`.
   */
  readonly target: number | null;
  /**
   * Duration of the count-up animation. When omitted the duration is
   * derived from the magnitude of the change (see `MS_PER_STEP`) so
   * small counts animate over a visible window rather than snapping.
   */
  readonly durationMs?: number;
}

/**
 * Gentle deceleration. Unlike a cubic ease-out (velocity 3 at the start)
 * this quadratic curve keeps the motion flatter, so the handful of
 * integer steps in a small count are spread across the whole duration
 * instead of being front-loaded into the first moments and then sitting
 * motionless at the final value.
 */
function easeOutQuad(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) * (1 - clamped);
}

function resolveDuration(delta: number, durationMs: number | undefined): number {
  if (durationMs !== undefined) {
    return durationMs;
  }
  const paced = Math.abs(delta) * MS_PER_STEP;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, paced));
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
  durationMs,
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
    const effectiveDuration = resolveDuration(delta, durationMs);
    const startTime = performance.now();

    const step = (timestamp: number) => {
      const linear = Math.min(1, (timestamp - startTime) / effectiveDuration);
      const eased = easeOutQuad(linear);
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
