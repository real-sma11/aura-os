/**
 * Persistence + DOM application for the per-panel "glass" theme options. Each
 * shell panel (left sidebar, middle main panel, right sidekick) can
 * independently swap its solid underlay for a frosted translucent
 * backdrop-filter so the wallpaper shows through behind it (see the
 * `[data-glass-*="true"]` rules in `AuraShell.module.css` /
 * `DesktopShell.module.css`).
 *
 * Defaults: only the left panel is on, preserving the behavior of the
 * earlier single "Glass sidebar" option. A legacy `aura-sidebar-glass`
 * value (the previous single-toggle key) is migrated into `left` when the
 * new key is absent.
 *
 * The attributes live on `document.documentElement` (mirroring `data-theme`)
 * so the boot script in `index.html` can pre-stamp them before React mounts.
 */

export type PanelKey = "left" | "middle" | "sidekick";

export type PanelGlass = Record<PanelKey, boolean>;

export const PANEL_KEYS: readonly PanelKey[] = ["left", "middle", "sidekick"];

export const DEFAULT_PANEL_GLASS: PanelGlass = {
  left: true,
  middle: false,
  sidekick: false,
};

const STORAGE_KEY = "aura-panel-glass";
const LEGACY_KEY = "aura-sidebar-glass";

const ATTR: Record<PanelKey, string> = {
  left: "data-glass-left",
  middle: "data-glass-middle",
  sidekick: "data-glass-sidekick",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadPanelGlass(): PanelGlass {
  if (typeof window === "undefined") return { ...DEFAULT_PANEL_GLASS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Migrate the previous single-toggle key: it disabled glass only on
      // an explicit "false", so the left default stays on otherwise.
      const legacy = window.localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        return { ...DEFAULT_PANEL_GLASS, left: legacy !== "false" };
      }
      return { ...DEFAULT_PANEL_GLASS };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_PANEL_GLASS };
    const out: PanelGlass = { ...DEFAULT_PANEL_GLASS };
    for (const key of PANEL_KEYS) {
      const value = parsed[key];
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return { ...DEFAULT_PANEL_GLASS };
  }
}

export function savePanelGlass(state: PanelGlass): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / privacy-mode storage: silently ignore so the UI
    // stays responsive. In-memory hook state remains the source of truth
    // for the current session.
  }
}

export function applyPanelGlassToDocument(state: PanelGlass): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of PANEL_KEYS) {
    if (state[key]) {
      root.setAttribute(ATTR[key], "true");
    } else {
      root.removeAttribute(ATTR[key]);
    }
  }
}
