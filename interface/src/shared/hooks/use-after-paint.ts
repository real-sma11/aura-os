import { useEffect, useState } from "react";

/**
 * Returns `false` on the mounting render and flips to `true` after the first
 * paint (next animation frame). Lets a component render a lightweight shell on
 * the critical frame and mount expensive children (e.g. images) one frame
 * later, off the path that blocks the current interaction.
 *
 * Pass `skip: true` to start in the `true` state immediately — useful when the
 * caller already knows the heavy work was done before (so re-mounts don't
 * re-defer and flicker).
 */
export function useAfterPaint(skip = false): boolean {
  const [painted, setPainted] = useState(skip);

  useEffect(() => {
    if (skip || painted) return;
    if (typeof requestAnimationFrame !== "function") {
      setPainted(true);
      return;
    }
    const id = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(id);
    // `painted`/`skip` are intentionally read once on mount; we never want to
    // re-arm the frame after it has fired.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return skip || painted;
}
