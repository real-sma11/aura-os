import { create } from "zustand";

/**
 * Global UI surface mode.
 *
 * Two values, fully determined by auth:
 *
 * - `"standard"` — the full DesktopShell with all apps, sidekicks, etc.
 *   What every authenticated user sees.
 * - `"public"` — the logged-out / marketing chat surface. Rendered for
 *   logged-out visitors by virtue of `!isAuthenticated`.
 *
 * Persisted via `localStorage["aura-ui-mode"]` so the value survives
 * reloads. A one-shot migration reads the legacy keys/values (the old
 * `"simple"` / `"advanced"` / `"normie"` values and the legacy
 * `aura-app-mode` key) and collapses them all to `"standard"` so
 * existing users land on the full shell after this refactor.
 */
export type UIMode = "standard" | "public";

const STORAGE_KEY = "aura-ui-mode";
const LEGACY_APP_MODE_KEY = "aura-app-mode";
const DEFAULT_MODE: UIMode = "standard";

/**
 * Read the persisted mode from `localStorage`, validating the raw
 * string against the literal union and migrating legacy keys/values
 * inline. Never throws; falls back to `DEFAULT_MODE` if storage is
 * unavailable.
 */
export function readPersistedMode(): UIMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "standard" || raw === "public") {
      return raw;
    }
    // Legacy values: simple-mode is gone, so any prior authed
    // preference collapses to the single authed surface.
    if (raw === "simple" || raw === "advanced" || raw === "normie") {
      return "standard";
    }
    const legacy = window.localStorage.getItem(LEGACY_APP_MODE_KEY);
    if (legacy === "simple" || legacy === "advanced") {
      window.localStorage.removeItem(LEGACY_APP_MODE_KEY);
      return "standard";
    }
  } catch {
    // localStorage may be unavailable (private browsing, quota, etc.)
  }
  return DEFAULT_MODE;
}

function writePersistedMode(mode: UIMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Quota / private mode — drop silently. Store stays correct in-memory.
  }
}

export interface UIModeState {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
}

/**
 * Derive the effective UI mode chrome should render from the live auth
 * state. Logged-out visitors always see `"public"`; everyone else sees
 * the full `"standard"` shell.
 *
 * Pure function (no store reads, no side effects) so it composes inside
 * selectors and tests without mocking.
 */
export function selectEffectiveMode(isAuthenticated: boolean): UIMode {
  return isAuthenticated ? "standard" : "public";
}

export const useUIModeStore = create<UIModeState>()((set, get) => ({
  mode: readPersistedMode(),
  setMode: (mode) => {
    if (get().mode === mode) return;
    writePersistedMode(mode);
    set({ mode });
  },
}));
