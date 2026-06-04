import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const ROW_SELECTOR = "[data-sidebar-list-reveal-row='true']";
const REVEAL_DURATION_MS = 240;
const REVEAL_STEP_MS = 24;
const REVEAL_MAX_STAGGER_INDEX = 14;
const REVEAL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

interface SidebarListRevealOptions {
  enabled?: boolean;
  itemCount: number;
  revealKey?: string | number;
}

function isReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function hasVisibleBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getRevealSignature(itemCount: number, revealKey: string | number | undefined): string {
  return `${itemCount}:${revealKey ?? itemCount}`;
}

/**
 * List-owned reveal animation for sidebar rows.
 *
 * The old implementation asked `LeftMenu` to time a `data-cascade` window for
 * descendants. That is brittle because these lists are virtualized and their
 * rows often mount after the pane becomes active. This hook waits until the
 * list's own scroll root is visible and populated, then animates the row DOM
 * nodes that are actually mounted.
 */
export function useSidebarListReveal(
  scrollRef: RefObject<HTMLElement | null>,
  { enabled = true, itemCount, revealKey }: SidebarListRevealOptions,
): void {
  const lastRevealedSignatureRef = useRef<string | null>(null);
  const wasVisibleRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const animationsRef = useRef<Animation[]>([]);

  const cancelAnimations = useCallback(() => {
    for (const animation of animationsRef.current) {
      animation.cancel();
    }
    animationsRef.current = [];
  }, []);

  const revealRows = useCallback(
    (force = false) => {
      const scrollRoot = scrollRef.current;

      if (!enabled || itemCount === 0 || !scrollRoot || isReducedMotion()) {
        return;
      }

      if (!hasVisibleBox(scrollRoot)) {
        return;
      }

      const signature = getRevealSignature(itemCount, revealKey);
      if (!force && lastRevealedSignatureRef.current === signature) {
        return;
      }

      const rows = Array.from(scrollRoot.querySelectorAll<HTMLElement>(ROW_SELECTOR));
      if (rows.length === 0 || typeof rows[0]?.animate !== "function") {
        return;
      }

      cancelAnimations();
      lastRevealedSignatureRef.current = signature;

      animationsRef.current = rows.map((row, index) => {
        const animation = row.animate(
          [
            { opacity: 0, transform: "translateY(7px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: REVEAL_DURATION_MS,
            delay: Math.min(index, REVEAL_MAX_STAGGER_INDEX) * REVEAL_STEP_MS,
            easing: REVEAL_EASING,
            fill: "backwards",
          },
        );

        animation.addEventListener(
          "finish",
          () => {
            animationsRef.current = animationsRef.current.filter((item) => item !== animation);
          },
          { once: true },
        );

        return animation;
      });
    },
    [cancelAnimations, enabled, itemCount, revealKey, scrollRef],
  );

  const scheduleReveal = useCallback(
    (force = false) => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        revealRows(force);
      });
    },
    [revealRows],
  );

  useLayoutEffect(() => {
    if (!enabled || itemCount === 0) return;
    scheduleReveal(false);
  }, [enabled, itemCount, revealKey, scheduleReveal]);

  useEffect(() => {
    const scrollRoot = scrollRef.current;
    if (!scrollRoot || typeof ResizeObserver === "undefined") {
      return;
    }

    wasVisibleRef.current = hasVisibleBox(scrollRoot);

    const observer = new ResizeObserver(() => {
      const isVisible = hasVisibleBox(scrollRoot);
      if (isVisible && !wasVisibleRef.current) {
        scheduleReveal(true);
      }
      wasVisibleRef.current = isVisible;
    });

    observer.observe(scrollRoot);

    return () => {
      observer.disconnect();
    };
  }, [scheduleReveal, scrollRef]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      cancelAnimations();
    },
    [cancelAnimations],
  );
}
