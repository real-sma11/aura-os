/**
 * Persisted preference for the authenticated shell layout.
 *
 * - `"simple"` renders the ChatGPT-style SimpleShell (sidebar + chat).
 * - `"advanced"` renders the full DesktopShell with all apps.
 *
 * Default: `"simple"` on web, `"advanced"` on desktop. Persisted to
 * `localStorage["aura-app-mode"]` so the preference survives across
 * sessions.
 */

import { create } from "zustand";

export type AppMode = "simple" | "advanced";

const STORAGE_KEY = "aura-app-mode";

function readPersistedMode(): AppMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "simple" || stored === "advanced") return stored;
  } catch {
    // localStorage may be unavailable (private browsing, quota, etc.)
  }
  return null;
}

function persistMode(mode: AppMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // best effort
  }
}

interface AppModeState {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggle: () => void;
}

export const useAppModeStore = create<AppModeState>((set, get) => ({
  mode: readPersistedMode() ?? "simple",
  setMode: (mode) => {
    persistMode(mode);
    set({ mode });
  },
  toggle: () => {
    const next = get().mode === "simple" ? "advanced" : "simple";
    persistMode(next);
    set({ mode: next });
  },
}));
