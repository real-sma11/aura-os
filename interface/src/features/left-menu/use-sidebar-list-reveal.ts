import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { LeftMenuPaneActiveContext } from "./pane-active-context";

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
  const paneActive = useContext(LeftMenuPaneActiveContext);
  const lastRevealedSignatureRef = useRef<string | null>(null);
  const wasVisibleRef = useRef(false);
  const wasPaneActiveRef = useRef(paneActive);
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

  // Deterministic switch trigger: when this list's keep-alive pane goes
  // inactive -> active (the Agents <-> Projects flip), replay the cascade.
  // This does not depend on `ResizeObserver` catching the `display:none`
  // -> visible transition, which is race-prone across a keep-alive show.
  useEffect(() => {
    const wasActive = wasPaneActiveRef.current;
    wasPaneActiveRef.current = paneActive;
    if (paneActive && !wasActive) {
      scheduleReveal(true);
    }
  }, [paneActive, scheduleReveal]);

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
