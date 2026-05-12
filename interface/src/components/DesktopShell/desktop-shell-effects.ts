import { useEffect, useLayoutEffect, type RefObject } from "react";

export function useLeftPanelWidthCssVar({
  leftPanelRef,
  isDesktop,
  activeAppId,
}: {
  leftPanelRef: RefObject<HTMLDivElement | null>;
  isDesktop: boolean;
  activeAppId: string;
}): void {
  // Measure before paint on app switches; this CSS var drives centered panels.
  useLayoutEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    const width = Math.round(el.getBoundingClientRect().width);
    document.documentElement.style.setProperty("--left-panel-width", `${width}px`);
  }, [leftPanelRef, isDesktop, activeAppId]);

  useEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    let lastWidth = -1;
    const ro = new ResizeObserver(([entry]) => {
      const rawWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      const nextWidth = Math.round(rawWidth);
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      document.documentElement.style.setProperty("--left-panel-width", `${nextWidth}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [leftPanelRef]);
}
