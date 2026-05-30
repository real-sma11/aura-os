import { useEffect, useRef, useState } from "react";

/**
 * Fast-but-visible count-up. The animation always runs from 0 up to the
 * target so the viewer perceives a quick odometer roll rather than the
 * value snapping into place. The default window is short enough to feel
 * snappy but long enough that every metric — small or large — visibly
 * ticks through intermediate values.
 */
const DEFAULT_DURATION_MS = 1000;

/**
 * Reduced-motion users still get a count-up (the effect is the point of
 * the banner) but over a much shorter window so it stays subtle.
 */
const REDUCED_MOTION_DURATION_MS = 350;

export interface UseCountUpOptions {
  /**
   * The final value to count up to. While `null` (data still loading)
   * the displayed value holds at 0; as soon as a finite number arrives
   * the value animates from 0 up to `target`.
   */
  readonly target: number | null;
  /**
   * Duration of the count-up animation. When omitted a sensible
   * fast-but-visible default is used (or a shorter window when the user
   * prefers reduced motion).
   */
  readonly durationMs?: number;
  /**
   * When this key changes the displayed value resets to 0 and the
   * animation replays — use `location.key` from React Router so every
   * navigation to a marketing page triggers a fresh count-up.
   */
  readonly resetKey?: unknown;
}

/**
 * Ease-out cubic: starts fast and decelerates into the final value, which
 * reads as a counter that spins up quickly then settles.
 */
function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
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
 * Animated count-up used by the marketing summary banners
 * (`/feedback`, `/changelog`, `/models`). The displayed value holds at 0
 * while `target` is `null` (query pending), then counts up from 0 to
 * `target` once a finite number is available — including on cached
 * revisits where the value is already known on mount. Pass `resetKey`
 * (e.g. `location.key`) to replay the animation on every page visit.
 * Reduced-motion users still get a count-up, just over a shorter window.
 */
export function useCountUp({
  target,
  durationMs,
  resetKey,
}: UseCountUpOptions): number {
  const [displayed, setDisplayed] = useState<number>(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const cancel = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    cancel();

    // State changes are funneled through rAF callbacks (never the effect
    // body) so React doesn't see a synchronous cascading setState and the
    // first painted frame of any reset/settle lands on the next tick.
    const settle = (value: number) => {
      frameRef.current = window.requestAnimationFrame(() => {
        setDisplayed(value);
        frameRef.current = null;
      });
    };

    // No data yet: hold at 0 until a finite target arrives.
    if (target === null) {
      settle(0);
      return cancel;
    }

    // Nothing to animate toward — land on the value directly.
    if (target <= 0) {
      settle(target);
      return cancel;
    }

    const duration =
      durationMs ??
      (prefersReducedMotion()
        ? REDUCED_MOTION_DURATION_MS
        : DEFAULT_DURATION_MS);
    const startTime = performance.now();

    const step = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startTime) / duration);
      // The roll always begins at 0 (progress 0 -> value 0) so the
      // count-up is unmistakable, then climbs to the exact target.
      setDisplayed(Math.round(target * easeOutCubic(progress)));
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        setDisplayed(target);
        frameRef.current = null;
      }
    };

    frameRef.current = window.requestAnimationFrame(step);
    return cancel;
  }, [target, durationMs, resetKey]);

  return displayed;
}
