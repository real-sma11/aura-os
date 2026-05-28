import { useEffect, useRef, useState } from "react";

const DEFAULT_LOADING_TARGET = 1000;
const DEFAULT_LOADING_RAMP_MS = 2500;
const DEFAULT_SNAP_MS = 350;

export interface UseCountUpOptions {
  /**
   * When `null`, the hook is in the "loading" phase and ramps the
   * displayed value linearly from 0 up to `loadingTarget`. As soon as a
   * finite number is provided, it transitions to the "resolved" phase
   * and rapidly snaps the displayed value to the new target.
   */
  readonly target: number | null;
  /** Value the loading ramp climbs toward. Defaults to 1000. */
  readonly loadingTarget?: number;
  /** Duration of the 0 -> loadingTarget ramp. Defaults to 2500ms. */
  readonly loadingRampMs?: number;
  /** Duration of the resolved-phase snap. Defaults to 350ms. */
  readonly snapMs?: number;
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
 * Animated count-up used by the `/changelog` summary card. While the
 * live-commits query is pending the displayed value climbs from 0 to
 * `loadingTarget` (default 1000) over `loadingRampMs`; once the real
 * count arrives the value rapidly eases from wherever it is now to the
 * final target over `snapMs`. Respects `prefers-reduced-motion` by
 * short-circuiting to the final value with no animation.
 */
export function useCountUp({
  target,
  loadingTarget = DEFAULT_LOADING_TARGET,
  loadingRampMs = DEFAULT_LOADING_RAMP_MS,
  snapMs = DEFAULT_SNAP_MS,
}: UseCountUpOptions): number {
  const [displayed, setDisplayed] = useState<number>(() => target ?? 0);
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

    // Reduced-motion users skip the ramp/snap animation. We still go
    // through a single rAF tick so the lint rule against synchronous
    // setState-in-effect stays happy and the state update lands on the
    // next paint instead of cascading into the same render.
    if (prefersReducedMotion()) {
      const finalValue = target ?? 0;
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
      const startTime = performance.now();
      const totalDelta = loadingTarget - startValue;

      if (totalDelta <= 0) {
        // Already at or past the loading cap; defer the parity-check
        // setState to a microtask so we don't synchronously kick a
        // second render from the effect body.
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
    const startTime = performance.now();

    const step = (timestamp: number) => {
      const linear = Math.min(1, (timestamp - startTime) / snapMs);
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
  }, [target, loadingTarget, loadingRampMs, snapMs]);

  return displayed;
}
