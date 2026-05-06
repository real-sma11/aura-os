import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 40;
const INPUT_OVERLAY_PX = 140;
const EXIT_FOLLOW_THRESHOLD_PX = BOTTOM_THRESHOLD_PX + INPUT_OVERLAY_PX + 48;
const ENTER_FOLLOW_THRESHOLD_PX = BOTTOM_THRESHOLD_PX + INPUT_OVERLAY_PX;

const UPWARD_SCROLL_KEYS = new Set([
  "ArrowUp",
  "PageUp",
  "Home",
]);

export interface UseScrollAnchorV2Return {
  handleScroll: () => void;
  scrollToBottom: () => void;
  isAutoFollowing: boolean;
  /**
   * Returns the `performance.now()` timestamp of the user's most recent
   * explicit scroll-up gesture (wheel up, swipe down, ArrowUp/PageUp/Home),
   * or `0` if the user is currently considered pinned. Auto-pin paths in
   * downstream components consult this to suppress repinning the moment
   * the user has shown intent to read older content, even if a streaming
   * layout flush would otherwise drag the viewport back to the bottom.
   */
  getUserUnpinnedAt: () => number;
}

/**
 * Tracks whether the user is pinned to the bottom of a scroll container, and
 * exposes an imperative `scrollToBottom` for handoffs (thread switch, send,
 * click-to-jump). Anchor preservation when content above the viewport changes
 * size (lane resize, loading older messages) is delegated to native CSS
 * `overflow-anchor`; this hook owns only the bits the browser can't do for us.
 *
 * Beyond pure position tracking, the hook also listens for explicit upward
 * scroll intent (wheel/touch/keyboard) on the container in the capture
 * phase. Detecting intent rather than waiting for the resulting scroll
 * position lets us disengage auto-follow synchronously, so a streaming
 * `useLayoutEffect` (or post-stream image-pin window) cannot fight a
 * partial drag. See `getUserUnpinnedAt` on the return type.
 */
export function useScrollAnchorV2(
  ref: React.RefObject<HTMLElement | null>,
  options: { resetKey?: unknown; scrollToBottomOnReset?: boolean },
): UseScrollAnchorV2Return {
  const { resetKey, scrollToBottomOnReset = true } = options;

  const pinnedRef = useRef(true);
  const guardRef = useRef(false);
  const userUnpinnedAtRef = useRef(0);
  const lastTouchYRef = useRef<number | null>(null);
  const [isAutoFollowing, setIsAutoFollowing] = useState(true);

  const syncFollowState = useCallback(() => {
    const next = pinnedRef.current;
    setIsAutoFollowing((prev) => (prev === next ? prev : next));
  }, []);

  const guardedScrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom <= 1) return;
    guardRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      guardRef.current = false;
    });
  }, [ref]);

  useLayoutEffect(() => {
    pinnedRef.current = true;
    userUnpinnedAtRef.current = 0;
    syncFollowState();
    if (scrollToBottomOnReset) {
      guardedScrollToBottom();
    }
  }, [resetKey, guardedScrollToBottom, scrollToBottomOnReset, syncFollowState]);

  const markUserUnpinned = useCallback(() => {
    userUnpinnedAtRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    if (pinnedRef.current) {
      pinnedRef.current = false;
      syncFollowState();
    }
  }, [syncFollowState]);

  const handleScroll = useCallback(() => {
    if (guardRef.current) return;
    const el = ref.current;
    if (!el) return;

    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    // Once the user has shown explicit upward intent, stay unpinned until
    // they truly return to the very bottom. The ENTER_FOLLOW_THRESHOLD_PX
    // band exists for users who haven't shown intent — applying it here
    // would let a sub-180px wheel-up be undone on the very next scroll
    // event, fighting the user every time they try to read older content.
    if (userUnpinnedAtRef.current > 0) {
      if (distFromBottom <= 1) {
        userUnpinnedAtRef.current = 0;
        if (!pinnedRef.current) {
          pinnedRef.current = true;
          syncFollowState();
        }
      }
      return;
    }

    const threshold = pinnedRef.current
      ? EXIT_FOLLOW_THRESHOLD_PX
      : ENTER_FOLLOW_THRESHOLD_PX;
    const nextPinned = distFromBottom < threshold;

    if (pinnedRef.current !== nextPinned) {
      pinnedRef.current = nextPinned;
      syncFollowState();
    }
  }, [ref, syncFollowState]);

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    userUnpinnedAtRef.current = 0;
    syncFollowState();
    guardedScrollToBottom();
  }, [guardedScrollToBottom, syncFollowState]);

  // Explicit upward intent: wheel up, swipe down (which scrolls content up),
  // or PageUp/ArrowUp/Home keypresses on the container. Capture phase so we
  // run before any descendant cancels the event, and synchronously so we
  // win the race against streaming `useLayoutEffect` flushes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0) markUserUnpinned();
    };
    const onTouchStart = (event: TouchEvent): void => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent): void => {
      const prev = lastTouchYRef.current;
      const next = event.touches[0]?.clientY ?? null;
      if (prev != null && next != null && next > prev) {
        // Finger moved downward → page scrolls upward → reading older content.
        markUserUnpinned();
      }
      lastTouchYRef.current = next;
    };
    const onTouchEnd = (): void => {
      lastTouchYRef.current = null;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (UPWARD_SCROLL_KEYS.has(event.key)) {
        markUserUnpinned();
        return;
      }
      if (event.key === " " && event.shiftKey) {
        markUserUnpinned();
      }
    };

    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    el.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    el.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: true,
    });
    el.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    el.addEventListener("touchcancel", onTouchEnd, {
      capture: true,
      passive: true,
    });
    el.addEventListener("keydown", onKeyDown, { capture: true });

    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
      el.removeEventListener("touchstart", onTouchStart, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchmove", onTouchMove, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchend", onTouchEnd, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchcancel", onTouchEnd, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("keydown", onKeyDown, {
        capture: true,
      } as EventListenerOptions);
    };
  }, [ref, markUserUnpinned]);

  const getUserUnpinnedAt = useCallback(() => userUnpinnedAtRef.current, []);

  return { handleScroll, scrollToBottom, isAutoFollowing, getUserUnpinnedAt };
}
