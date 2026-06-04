import { useCallback, useEffect, useState } from "react";
import {
  applyGlassLevelToDocument,
  clampBlur,
  clampOpacity,
  loadGlassLevel,
  saveGlassLevel,
  type GlassLevel,
} from "../lib/glass-level";

export type UseGlassLevelResult = {
  /** Current blur radius (px) + chrome opacity (%). */
  level: GlassLevel;
  /** Persist + apply a new blur radius (px). */
  setBlur: (blur: number) => void;
  /** Persist + apply a new chrome opacity (%). */
  setOpacity: (opacity: number) => void;
};

/**
 * Single writer of the `--shell-chrome-blur` / `--shell-chrome-opacity`
 * custom properties. Seeds from storage, reapplies on mount, and persists
 * user changes. Mounted once via `PanelGlassBridge` so the level stays in
 * sync app-wide. State changes reapply through the effect, giving live
 * updates while a slider drags.
 */
export function useGlassLevel(): UseGlassLevelResult {
  const [level, setLevel] = useState<GlassLevel>(loadGlassLevel);

  useEffect(() => {
    applyGlassLevelToDocument(level);
  }, [level]);

  const setBlur = useCallback((blur: number) => {
    setLevel((prev) => {
      const next: GlassLevel = { ...prev, blur: clampBlur(blur) };
      saveGlassLevel(next);
      return next;
    });
  }, []);

  const setOpacity = useCallback((opacity: number) => {
    setLevel((prev) => {
      const next: GlassLevel = { ...prev, opacity: clampOpacity(opacity) };
      saveGlassLevel(next);
      return next;
    });
  }, []);

  return { level, setBlur, setOpacity };
}
