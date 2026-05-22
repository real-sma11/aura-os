import { create } from "zustand";

/**
 * Global UI "complexity" mode toggle.
 *
 * - `normie`: simplified public/logged-out style surface. When set on
 *   an authenticated user, the router mounts `LoggedOutShell` instead
 *   of `DesktopShell` so the user sees the same chat-only UI guests
 *   see today.
 * - `advanced`: full DesktopShell with all apps, sidekicks, etc.
 *
 * Default `advanced` so existing logged-in users see no behaviour
 * change until they explicitly flip the toggle. Persisted via
 * `localStorage` so the choice survives reloads.
 */
export type UIMode = "normie" | "advanced";

const STORAGE_KEY = "aura-ui-mode";
const DEFAULT_MODE: UIMode = "advanced";

function readPersistedMode(): UIMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "normie" || raw === "advanced" ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function writePersistedMode(mode: UIMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Quota / private mode — drop silently. Store stays correct in-memory.
  }
}

interface UIModeState {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
  toggleMode: () => void;
}

export const useUIModeStore = create<UIModeState>()((set, get) => ({
  mode: readPersistedMode(),
  setMode: (mode) => {
    if (get().mode === mode) return;
    writePersistedMode(mode);
    set({ mode });
  },
  toggleMode: () => {
    const next: UIMode = get().mode === "normie" ? "advanced" : "normie";
    writePersistedMode(next);
    set({ mode: next });
  },
}));
