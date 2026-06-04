/**
 * Persistence + DOM application for the Settings > Theme > Layout & density
 * controls: a corner-radius preset (overriding the `--radius-*` token scale,
 * which ships at 0 / sharp by default) and a UI density mode (overriding the
 * `--control-height-*` tokens + a `data-density` attribute for CSS hooks).
 *
 * Like the other theme-extras modules, values are written as inline styles on
 * `document.documentElement` and pre-stamped by the boot script in
 * `index.html` so a customized layout never flashes the defaults.
 */

export type RadiusPreset = "sharp" | "soft" | "round";
export type Density = "comfortable" | "compact";

export type Layout = {
  radius: RadiusPreset;
  density: Density;
};

export const DEFAULT_LAYOUT: Layout = {
  radius: "sharp",
  density: "comfortable",
};

export const RADIUS_PRESETS: readonly { id: RadiusPreset; label: string }[] = [
  { id: "sharp", label: "Sharp" },
  { id: "soft", label: "Soft" },
  { id: "round", label: "Round" },
];

export const DENSITY_OPTIONS: readonly { id: Density; label: string }[] = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];

/** `--radius-sm/md/lg/xl` values applied per preset. */
const RADIUS_VALUES: Record<RadiusPreset, Record<string, string>> = {
  sharp: {
    "--radius-sm": "0",
    "--radius-md": "0",
    "--radius-lg": "0",
    "--radius-xl": "0",
  },
  soft: {
    "--radius-sm": "4px",
    "--radius-md": "6px",
    "--radius-lg": "10px",
    "--radius-xl": "14px",
  },
  round: {
    "--radius-sm": "8px",
    "--radius-md": "12px",
    "--radius-lg": "18px",
    "--radius-xl": "26px",
  },
};

/** `--control-height-*` values applied per density. */
const DENSITY_VALUES: Record<Density, Record<string, string>> = {
  comfortable: {
    "--control-height-xs": "28px",
    "--control-height-sm": "32px",
    "--control-height-md": "36px",
    "--control-height-lg": "44px",
  },
  compact: {
    "--control-height-xs": "24px",
    "--control-height-sm": "28px",
    "--control-height-md": "32px",
    "--control-height-lg": "38px",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRadiusPreset(value: unknown): value is RadiusPreset {
  return value === "sharp" || value === "soft" || value === "round";
}

function isDensity(value: unknown): value is Density {
  return value === "comfortable" || value === "compact";
}

const STORAGE_KEY = "aura-layout";

export function loadLayout(): Layout {
  if (typeof window === "undefined") return { ...DEFAULT_LAYOUT };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_LAYOUT };
    return {
      radius: isRadiusPreset(parsed.radius)
        ? parsed.radius
        : DEFAULT_LAYOUT.radius,
      density: isDensity(parsed.density)
        ? parsed.density
        : DEFAULT_LAYOUT.density,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(state: Layout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / privacy-mode storage: silently ignore.
  }
}

export function applyLayoutToDocument(state: Layout): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const radius = isRadiusPreset(state.radius) ? state.radius : DEFAULT_LAYOUT.radius;
  const density = isDensity(state.density) ? state.density : DEFAULT_LAYOUT.density;
  for (const [token, value] of Object.entries(RADIUS_VALUES[radius])) {
    root.style.setProperty(token, value);
  }
  for (const [token, value] of Object.entries(DENSITY_VALUES[density])) {
    root.style.setProperty(token, value);
  }
  root.setAttribute("data-density", density);
}
