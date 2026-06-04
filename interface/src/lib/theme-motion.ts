/**
 * Persistence + DOM application for the Settings > Theme > Motion controls: a
 * reduce-motion toggle and a transition-duration scale.
 *
 * `reduceMotion` stamps `data-motion="reduced"` on `document.documentElement`;
 * a global rule in `index.css` collapses transitions/animations under that
 * attribute. The duration scale rewrites the `--transition-fast/normal/slow`
 * tokens (defined in `vendor/zui/src/styles/tokens.css`). Boot-script
 * pre-stamping (see `index.html`) keeps the first paint flash-free.
 */

export type Motion = {
  /** When true, transitions/animations are effectively disabled. */
  reduceMotion: boolean;
  /** Transition-duration scale as a percentage (100 = default speed). */
  speed: number;
};

export const DEFAULT_MOTION: Motion = {
  reduceMotion: false,
  speed: 100,
};

export const MOTION_SPEED_MIN = 50;
export const MOTION_SPEED_MAX = 200;

/** Base durations (ms) the scale multiplies. Mirrors the `--transition-*` tokens. */
const TRANSITION_BASES: Record<string, number> = {
  "--transition-fast": 75,
  "--transition-normal": 150,
  "--transition-slow": 300,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clampMotionSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MOTION.speed;
  return Math.min(MOTION_SPEED_MAX, Math.max(MOTION_SPEED_MIN, Math.round(value)));
}

const STORAGE_KEY = "aura-motion";

export function loadMotion(): Motion {
  if (typeof window === "undefined") return { ...DEFAULT_MOTION };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MOTION };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_MOTION };
    return {
      reduceMotion:
        typeof parsed.reduceMotion === "boolean"
          ? parsed.reduceMotion
          : DEFAULT_MOTION.reduceMotion,
      speed:
        typeof parsed.speed === "number"
          ? clampMotionSpeed(parsed.speed)
          : DEFAULT_MOTION.speed,
    };
  } catch {
    return { ...DEFAULT_MOTION };
  }
}

export function saveMotion(state: Motion): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / privacy-mode storage: silently ignore.
  }
}

export function applyMotionToDocument(state: Motion): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Higher "speed" = snappier UI = shorter durations, so divide the base.
  const factor = 100 / clampMotionSpeed(state.speed);
  for (const [token, base] of Object.entries(TRANSITION_BASES)) {
    root.style.setProperty(token, `${Math.round(base * factor)}ms ease-out`);
  }
  if (state.reduceMotion) {
    root.setAttribute("data-motion", "reduced");
  } else {
    root.removeAttribute("data-motion");
  }
}
