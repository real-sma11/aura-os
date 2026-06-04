import { useCallback, useEffect, useState } from "react";
import {
  applyTypographyToDocument,
  clampTypographyScale,
  loadTypography,
  saveTypography,
  type Typography,
} from "../lib/theme-typography";

export type UseTypographyResult = {
  /** Current sans/mono font ids + text scale. */
  typography: Typography;
  /** Persist + apply a new sans font id. */
  setSans: (id: string) => void;
  /** Persist + apply a new mono font id. */
  setMono: (id: string) => void;
  /** Persist + apply a new text-size scale (%). */
  setScale: (scale: number) => void;
};

/**
 * Single writer of the typography custom properties (`--font-sans`,
 * `--font-mono`, `--text-*`). Seeds from storage, reapplies on mount, and
 * persists user changes. Mounted once via `ThemeExtrasBridge`.
 */
export function useTypography(): UseTypographyResult {
  const [typography, setTypography] = useState<Typography>(loadTypography);

  useEffect(() => {
    applyTypographyToDocument(typography);
  }, [typography]);

  const setSans = useCallback((id: string) => {
    setTypography((prev) => {
      const next: Typography = { ...prev, sans: id };
      saveTypography(next);
      return next;
    });
  }, []);

  const setMono = useCallback((id: string) => {
    setTypography((prev) => {
      const next: Typography = { ...prev, mono: id };
      saveTypography(next);
      return next;
    });
  }, []);

  const setScale = useCallback((scale: number) => {
    setTypography((prev) => {
      const next: Typography = { ...prev, scale: clampTypographyScale(scale) };
      saveTypography(next);
      return next;
    });
  }, []);

  return { typography, setSans, setMono, setScale };
}
