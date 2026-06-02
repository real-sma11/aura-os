import { useEffect, useRef } from "react";

/**
 * Pointer-tracking 3D tilt for a card surface.
 *
 * Attaches pointer listeners to the returned element and writes tilt angles as
 * CSS custom properties (`--tilt-x`, `--tilt-y`) plus a `--tilt-active` flag,
 * instead of triggering React re-renders, so the transform animates smoothly.
 * The actual transform/lift lives in CSS.
 *
 * No-ops when the user prefers reduced motion.
 */
const MAX_TILT_DEG = 6;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useCardTilt<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    const handleMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // -0.5..0.5 relative to card center.
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;

      // rotateY follows horizontal pointer, rotateX inverts vertical pointer so
      // the card leans toward the cursor.
      el.style.setProperty("--tilt-x", `${(px * MAX_TILT_DEG).toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${(-py * MAX_TILT_DEG).toFixed(2)}deg`);
      el.style.setProperty("--tilt-active", "1");
    };

    const handleLeave = () => {
      el.style.setProperty("--tilt-x", "0deg");
      el.style.setProperty("--tilt-y", "0deg");
      el.style.setProperty("--tilt-active", "0");
    };

    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerleave", handleLeave);
    return () => {
      el.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerleave", handleLeave);
    };
  }, []);

  return ref;
}
