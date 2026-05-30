import { useEffect, useRef, useState } from "react";

/**
 * When no explicit `durationMs` is given the animation length is derived
 * from how many integer steps it has to traverse, so small counts still
 * get a perceptible window instead of finishing in a few frames. Each
 * step is paced at `MS_PER_STEP`, clamped between `MIN_DURATION_MS` and
 * `MAX_DURATION_MS`.
 */
const MS_PER_STEP = 40;
const MIN_DURATION_MS = 500;
const MAX_DURATION_MS = 1200;

const DEFAULT_LOADING_TARGET = 99;
const DEFAULT_LOADING_RAMP_MS = 1800;

export interface UseCountUpOptions {
  /**
   * The final value to count up to. While `null` (data still loading)
   * the displayed value ramps toward `loadingTarget` over
   * `loadingRampMs`. As soon as a finite number arrives the displayed
   * value eases from where it is now up to `target`.
   */
  readonly target: number | null;
  /**
   * Duration of the count-up animation. When omitted the duration is
   * derived from the magnitude of the change (see `MS_PER_STEP`) so
   * small counts animate over a visible window rather than snapping.
   */
  readonly durationMs?: number;
  /**
   * When this key changes the displayed value resets to 0 and the
   * animation replays — use `location.key` from React Router so every
   * navigation to a marketing page triggers a fresh count-up.
   */
  readonly resetKey?: unknown;
  /**
   * While `target` is `null`, ramp the displayed value toward this
   * sentinel so the banner visibly counts during fetch.
   */
  readonly loadingTarget?: number;
  /** Duration of the 0 -> loadingTarget ramp. Defaults to 1800ms. */
  readonly loadingRampMs?: number;
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
 * value starts at 0 and eases up to `target` once a finite number is
 * available — including on cached revisits where the value is already
 * known on mount. While `target` is `null` (query pending) the value
 * ramps toward `loadingTarget`. Pass `resetKey` (e.g. `location.key`)
 * to replay the animation on every page visit. Respects
 * `prefers-reduced-motion` by short-circuiting to the final value with
 * no animation.
 */
export function useCountUp({
  target,
  durationMs,
  resetKey,
  loadingTarget = DEFAULT_LOADING_TARGET,
  loadingRampMs = DEFAULT_LOADING_RAMP_MS,
}: UseCountUpOptions): number {
  const [displayed, setDisplayed] = useState<number>(0);
  const displayedRef = useRef<number>(displayed);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  // Reset to 0 whenever the visit key changes so revisits replay the
  // count-up even if React reuses the component instance.
  useEffect(() => {
    setDisplayed(0);
    displayedRef.current = 0;
  }, [resetKey]);

  useEffect(() => {
    const cancel = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    cancel();

    // Reduced-motion users skip animation. We still go through a single
    // rAF tick so the state update lands on the next paint instead of
    // cascading synchronously out of the effect body.
    if (prefersReducedMotion()) {
      const finalValue = target ?? loadingTarget;
      frameRef.current = window.requestAnimationFrame(() => {
        if (displayedRef.current !== finalValue) {
          setDisplayed(finalValue);
        }
        frameRef.current = null;
      });
      return cancel;
    }

    if (target === null) {
      const startValue = displayedRef.current;
      const totalDelta = loadingTarget - startValue;

      if (totalDelta <= 0) {
        frameRef.current = window.requestAnimationFrame(() => {
          if (displayedRef.current !== loadingTarget) {
            setDisplayed(loadingTarget);
          }
          frameRef.current = null;
        });
        return cancel;
      }

      const remainingMs = Math.max(
        16,
        (loadingRampMs * totalDelta) / loadingTarget,
      );
      const startTime = performance.now();

      const step = (timestamp: number) => {
        const progress = Math.min(1, (timestamp - startTime) / remainingMs);
        const next = Math.round(startValue + totalDelta * progress);
        if (next !== displayedRef.current) {
          setDisplayed(next);
        }
        if (progress < 1) {
          frameRef.current = window.requestAnimationFrame(step);
        } else {
          frameRef.current = null;
        }
      };
      frameRef.current = window.requestAnimationFrame(step);
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
  }, [target, durationMs, resetKey, loadingTarget, loadingRampMs]);

  return displayed;
}
