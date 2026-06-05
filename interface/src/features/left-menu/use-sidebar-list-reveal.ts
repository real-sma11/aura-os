import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

interface SidebarListRevealOptions {
  enabled?: boolean;
  itemCount: number;
  revealKey?: string | number;
}

export interface SidebarListRevealState {
  enabled: boolean;
  epoch: number;
  startedAt: number;
}

function hasVisibleBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getRevealSignature(itemCount: number, revealKey: string | number | undefined): string {
  return `${itemCount}:${revealKey ?? itemCount}`;
}

export function isSidebarRevealReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Creates short-lived reveal epochs for a sidebar list.
 *
 * The list decides *when* a reveal is valid: when its scroll root is visible and
 * populated, or when a hidden keep-alive pane becomes visible. Rows decide
 * *how* to animate: each row component runs its own layout effect after that
 * exact row element has mounted. That keeps virtualization and async hydration
 * from racing a parent-level query/selector.
 */
export function useSidebarListReveal(
  scrollRef: RefObject<HTMLElement | null>,
  { enabled = true, itemCount, revealKey }: SidebarListRevealOptions,
): SidebarListRevealState {
  const [reveal, setReveal] = useState<SidebarListRevealState>({
    enabled,
    epoch: 0,
    startedAt: 0,
  });
  const lastRevealedSignatureRef = useRef<string | null>(null);
  const wasVisibleRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  const startReveal = useCallback(
    (force = false) => {
      const scrollRoot = scrollRef.current;

      if (!enabled || itemCount === 0 || !scrollRoot || isSidebarRevealReducedMotion()) {
        return;
      }

      if (!hasVisibleBox(scrollRoot)) {
        return;
      }

      const signature = getRevealSignature(itemCount, revealKey);
      if (!force && lastRevealedSignatureRef.current === signature) {
        return;
      }

      lastRevealedSignatureRef.current = signature;
      setReveal((current) => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        return {
          enabled,
          epoch: current.epoch + 1,
          startedAt: now,
        };
      });
    },
    [enabled, itemCount, revealKey, scrollRef],
  );

  const scheduleReveal = useCallback(
    (force = false) => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        startReveal(force);
      });
    },
    [startReveal],
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
    },
    [],
  );

  return reveal;
}
