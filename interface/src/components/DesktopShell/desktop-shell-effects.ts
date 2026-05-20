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

export function useSidekickWidthCssVar({
  sidekickLaneRef,
  collapsed,
  activeAppId,
}: {
  sidekickLaneRef: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  activeAppId: string;
}): void {
  // Sidekick-aware centering relies on this var. When the lane is collapsed
  // the DOM node is still mounted (the `Lane` animates its width via CSS),
  // so force the var to 0 instead of trusting the measured width.
  useLayoutEffect(() => {
    if (collapsed) {
      document.documentElement.style.setProperty("--sidekick-width", "0px");
      return;
    }
    const el = sidekickLaneRef.current;
    if (!el) return;
    const width = Math.round(el.getBoundingClientRect().width);
    document.documentElement.style.setProperty("--sidekick-width", `${width}px`);
  }, [sidekickLaneRef, collapsed, activeAppId]);

  useEffect(() => {
    if (collapsed) return;
    const el = sidekickLaneRef.current;
    if (!el) return;
    let lastWidth = -1;
    const ro = new ResizeObserver(([entry]) => {
      const rawWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      const nextWidth = Math.round(rawWidth);
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      document.documentElement.style.setProperty("--sidekick-width", `${nextWidth}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [sidekickLaneRef, collapsed]);
}
