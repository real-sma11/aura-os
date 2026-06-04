/**
 * Persistence + DOM application for the tunable "glass level" knobs (blur
 * radius and chrome opacity) exposed by the Settings > Theme > Effects
 * sliders. These drive the `--shell-chrome-blur` / `--shell-chrome-opacity`
 * custom properties that the shared `--shell-chrome-*` recipe in `index.css`
 * consumes, so every frosted chrome surface (glass panels, titlebar pill,
 * bottom taskbar) follows the same level.
 *
 * Values are written as inline styles on `document.documentElement`, which
 * beat the `:root` defaults by specificity (same approach as
 * `lib/theme-overrides.ts`). The boot script in `index.html` pre-stamps them
 * before first paint to avoid a flash back to the default recipe.
 */

export type GlassLevel = {
  /** Backdrop blur radius in px. */
  blur: number;
  /** Chrome fill opacity as a percentage (higher = more solid). */
  opacity: number;
};

export const DEFAULT_GLASS_LEVEL: GlassLevel = {
  blur: 40,
  opacity: 90,
};

export const GLASS_BLUR_MIN = 0;
export const GLASS_BLUR_MAX = 80;
export const GLASS_OPACITY_MIN = 40;
export const GLASS_OPACITY_MAX = 100;

const STORAGE_KEY = "aura-glass-level";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampBlur(value: number): number {
  return clamp(value, GLASS_BLUR_MIN, GLASS_BLUR_MAX);
}

export function clampOpacity(value: number): number {
  return clamp(value, GLASS_OPACITY_MIN, GLASS_OPACITY_MAX);
}

export function loadGlassLevel(): GlassLevel {
  if (typeof window === "undefined") return { ...DEFAULT_GLASS_LEVEL };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GLASS_LEVEL };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_GLASS_LEVEL };
    return {
      blur:
        typeof parsed.blur === "number"
          ? clampBlur(parsed.blur)
          : DEFAULT_GLASS_LEVEL.blur,
      opacity:
        typeof parsed.opacity === "number"
          ? clampOpacity(parsed.opacity)
          : DEFAULT_GLASS_LEVEL.opacity,
    };
  } catch {
    return { ...DEFAULT_GLASS_LEVEL };
  }
}

export function saveGlassLevel(state: GlassLevel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / privacy-mode storage: silently ignore so the UI stays
    // responsive. In-memory hook state remains the source of truth for the
    // current session.
  }
}

export function applyGlassLevelToDocument(state: GlassLevel): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--shell-chrome-blur", `${clampBlur(state.blur)}px`);
  root.style.setProperty(
    "--shell-chrome-opacity",
    `${clampOpacity(state.opacity)}%`,
  );
}
