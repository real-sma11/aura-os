import { create } from "zustand";

/**
 * Global UI "complexity" mode toggle.
 *
 * Three persistable values, one effective value derived from
 * `(persistedMode, isAuthenticated)` via `selectEffectiveMode`.
 *
 * - `"simple"` — simplified chat-only surface for authenticated users.
 *   Persistable; what the ModeToggle writes when the user picks the
 *   "Simple" segment.
 * - `"advanced"` — full DesktopShell with all apps, sidekicks, etc.
 *   Persistable; what the ModeToggle writes when the user picks the
 *   "Advanced" segment.
 * - `"public"` — the logged-out / marketing chat surface. Persistable
 *   for completeness (the migrated value space includes it) but the
 *   ModeToggle never writes it; logged-out users render this mode by
 *   virtue of `!isAuthenticated`, and a logged-in user persisting
 *   `"public"` is squashed back to `"simple"` by `selectEffectiveMode`.
 *
 * Persisted via `localStorage["aura-ui-mode"]` so the choice survives
 * reloads. A one-shot migration reads the legacy `aura-app-mode` key
 * (and the legacy `"normie"` value) so existing users don't get
 * reset on first load after this refactor.
 */
export type UIMode = "simple" | "advanced" | "public";

const STORAGE_KEY = "aura-ui-mode";
const LEGACY_APP_MODE_KEY = "aura-app-mode";
const DEFAULT_MODE: UIMode = "simple";

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
    if (raw === "simple" || raw === "advanced" || raw === "public") {
      return raw;
    }
    if (raw === "normie") {
      return "simple";
    }
    const legacy = window.localStorage.getItem(LEGACY_APP_MODE_KEY);
    if (legacy === "simple" || legacy === "advanced") {
      window.localStorage.removeItem(LEGACY_APP_MODE_KEY);
      return legacy;
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
  toggleMode: () => void;
}

/**
 * Derive the effective UI mode chrome should render from the stored
 * preference plus the live auth state.
 *
 * Pure function (no store reads, no side effects) so it composes
 * inside selectors and tests without mocking.
 *
 * - Logged-out users always see `"public"`, regardless of what they
 *   may have persisted while previously signed in.
 * - A logged-in user whose persisted preference is `"public"` is
 *   squashed to `"simple"` (the ModeToggle never writes `"public"`,
 *   but a stale localStorage value or a future surface that does
 *   could land here).
 * - Otherwise the stored preference flows through unchanged.
 */
export function selectEffectiveMode(
  state: UIModeState,
  isAuthenticated: boolean,
): UIMode {
  if (!isAuthenticated) return "public";
  if (state.mode === "public") return "simple";
  return state.mode;
}

export const useUIModeStore = create<UIModeState>()((set, get) => ({
  mode: readPersistedMode(),
  setMode: (mode) => {
    if (get().mode === mode) return;
    writePersistedMode(mode);
    set({ mode });
  },
  toggleMode: () => {
    const next: UIMode = get().mode === "simple" ? "advanced" : "simple";
    writePersistedMode(next);
    set({ mode: next });
  },
}));
