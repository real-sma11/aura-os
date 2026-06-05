import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  isSidebarRevealReducedMotion,
  type SidebarListRevealState,
} from "./use-sidebar-list-reveal";

const REVEAL_DURATION_MS = 240;
const REVEAL_STEP_MS = 24;
const REVEAL_MAX_STAGGER_INDEX = 14;
const REVEAL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const REVEAL_ACTIVE_WINDOW_MS =
  REVEAL_DURATION_MS + REVEAL_MAX_STAGGER_INDEX * REVEAL_STEP_MS + 80;

interface SidebarRevealRowProps {
  reveal: SidebarListRevealState;
  revealIndex: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function SidebarRevealRow({
  reveal,
  revealIndex,
  className,
  style,
  children,
}: SidebarRevealRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !reveal.enabled || reveal.epoch === 0 || isSidebarRevealReducedMotion()) {
      return;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - reveal.startedAt > REVEAL_ACTIVE_WINDOW_MS) {
      return;
    }

    if (typeof row.animate !== "function") {
      return;
    }

    const animation = row.animate(
      [
        { opacity: 0, transform: "translateY(7px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: REVEAL_DURATION_MS,
        delay: Math.min(revealIndex, REVEAL_MAX_STAGGER_INDEX) * REVEAL_STEP_MS,
        easing: REVEAL_EASING,
        fill: "backwards",
      },
    );

    return () => animation.cancel();
  }, [reveal.enabled, reveal.epoch, reveal.startedAt, revealIndex]);

  return (
    <div ref={rowRef} className={className} style={style}>
      {children}
    </div>
  );
}
