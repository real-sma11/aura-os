import { useCallback, useEffect, useState } from "react";
import {
  applyPanelGlassToDocument,
  loadPanelGlass,
  savePanelGlass,
  type PanelGlass,
  type PanelKey,
} from "../lib/panel-glass";

export type UsePanelGlassResult = {
  /** Current per-panel glass enabled state. */
  glass: PanelGlass;
  /** Persist + apply a new enabled state for a single panel. */
  setPanel: (panel: PanelKey, on: boolean) => void;
};

/**
 * Single writer of the `data-glass-*` attributes. Seeds from storage
 * (left default-on), reapplies on mount, and persists user changes. Mounted
 * once via `PanelGlassBridge` so the attributes stay in sync app-wide.
 */
export function usePanelGlass(): UsePanelGlassResult {
  const [glass, setGlass] = useState<PanelGlass>(loadPanelGlass);

  useEffect(() => {
    applyPanelGlassToDocument(glass);
  }, [glass]);

  const setPanel = useCallback((panel: PanelKey, on: boolean) => {
    setGlass((prev) => {
      const next: PanelGlass = { ...prev, [panel]: on };
      savePanelGlass(next);
      return next;
    });
  }, []);

  return { glass, setPanel };
}
