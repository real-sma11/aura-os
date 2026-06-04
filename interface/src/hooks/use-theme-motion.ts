import { useCallback, useEffect, useState } from "react";
import {
  applyMotionToDocument,
  clampMotionSpeed,
  loadMotion,
  saveMotion,
  type Motion,
} from "../lib/theme-motion";

export type UseMotionResult = {
  /** Current reduce-motion flag + transition speed (%). */
  motion: Motion;
  /** Persist + apply the reduce-motion toggle. */
  setReduceMotion: (reduceMotion: boolean) => void;
  /** Persist + apply a new transition speed (%). */
  setSpeed: (speed: number) => void;
};

/**
 * Single writer of the motion custom properties (`--transition-*`) and the
 * `data-motion` attribute. Seeds from storage, reapplies on mount, and
 * persists user changes. Mounted once via `ThemeExtrasBridge`.
 */
export function useMotion(): UseMotionResult {
  const [motion, setMotion] = useState<Motion>(loadMotion);

  useEffect(() => {
    applyMotionToDocument(motion);
  }, [motion]);

  const setReduceMotion = useCallback((reduceMotion: boolean) => {
    setMotion((prev) => {
      const next: Motion = { ...prev, reduceMotion };
      saveMotion(next);
      return next;
    });
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setMotion((prev) => {
      const next: Motion = { ...prev, speed: clampMotionSpeed(speed) };
      saveMotion(next);
      return next;
    });
  }, []);

  return { motion, setReduceMotion, setSpeed };
}
