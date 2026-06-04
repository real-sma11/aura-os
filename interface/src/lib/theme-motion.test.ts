import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMotionToDocument,
  clampMotionSpeed,
  DEFAULT_MOTION,
  loadMotion,
  MOTION_SPEED_MAX,
  MOTION_SPEED_MIN,
  saveMotion,
} from "./theme-motion";

const STORAGE_KEY = "aura-motion";

describe("theme-motion", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-motion");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-motion");
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadMotion()).toEqual(DEFAULT_MOTION);
  });

  it("round-trips a saved value", () => {
    saveMotion({ reduceMotion: true, speed: 150 });
    expect(loadMotion()).toEqual({ reduceMotion: true, speed: 150 });
  });

  it("falls back to defaults when JSON is malformed", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadMotion()).toEqual(DEFAULT_MOTION);
  });

  it("clamps the speed into range", () => {
    expect(clampMotionSpeed(1)).toBe(MOTION_SPEED_MIN);
    expect(clampMotionSpeed(9999)).toBe(MOTION_SPEED_MAX);
    expect(clampMotionSpeed(Number.NaN)).toBe(DEFAULT_MOTION.speed);
  });

  it("scales transition durations (higher speed = shorter)", () => {
    applyMotionToDocument({ reduceMotion: false, speed: 200 });
    const style = document.documentElement.style;
    // factor = 100 / 200 = 0.5 -> round(75 * 0.5) = 38ms.
    expect(style.getPropertyValue("--transition-fast")).toBe("38ms ease-out");
    expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
  });

  it("stamps the reduce-motion attribute when enabled", () => {
    applyMotionToDocument({ reduceMotion: true, speed: 100 });
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduced");
  });
});
