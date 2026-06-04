import { useCallback, useEffect, useState } from "react";
import {
  applyLayoutToDocument,
  loadLayout,
  saveLayout,
  type Density,
  type Layout,
  type RadiusPreset,
} from "../lib/theme-layout";

export type UseLayoutResult = {
  /** Current corner-radius preset + density. */
  layout: Layout;
  /** Persist + apply a new corner-radius preset. */
  setRadius: (radius: RadiusPreset) => void;
  /** Persist + apply a new density mode. */
  setDensity: (density: Density) => void;
};

/**
 * Single writer of the layout custom properties (`--radius-*`,
 * `--control-height-*`) and the `data-density` attribute. Seeds from storage,
 * reapplies on mount, and persists user changes. Mounted once via
 * `ThemeExtrasBridge`.
 */
export function useLayout(): UseLayoutResult {
  const [layout, setLayout] = useState<Layout>(loadLayout);

  useEffect(() => {
    applyLayoutToDocument(layout);
  }, [layout]);

  const setRadius = useCallback((radius: RadiusPreset) => {
    setLayout((prev) => {
      const next: Layout = { ...prev, radius };
      saveLayout(next);
      return next;
    });
  }, []);

  const setDensity = useCallback((density: Density) => {
    setLayout((prev) => {
      const next: Layout = { ...prev, density };
      saveLayout(next);
      return next;
    });
  }, []);

  return { layout, setRadius, setDensity };
}
