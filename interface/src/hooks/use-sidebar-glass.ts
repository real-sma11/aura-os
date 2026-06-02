import { useCallback, useEffect, useState } from "react";
import {
  applySidebarGlassToDocument,
  loadSidebarGlass,
  saveSidebarGlass,
} from "../lib/sidebar-glass";

export type UseSidebarGlassResult = {
  /** Whether the glass sidebar underlay is currently enabled. */
  enabled: boolean;
  /** Persist + apply a new enabled state. */
  setEnabled: (on: boolean) => void;
};

/**
 * Single writer of the `data-sidebar-glass` attribute. Seeds from storage
 * (default-on), reapplies on mount, and persists user changes. Mounted once
 * via `SidebarGlassBridge` so the attribute is kept in sync app-wide.
 */
export function useSidebarGlass(): UseSidebarGlassResult {
  const [enabled, setEnabledState] = useState<boolean>(loadSidebarGlass);

  useEffect(() => {
    applySidebarGlassToDocument(enabled);
  }, [enabled]);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    saveSidebarGlass(on);
  }, []);

  return { enabled, setEnabled };
}
