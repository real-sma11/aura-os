import { create } from "zustand";
import type { ReactNode } from "react";
import { PREVIOUS_PATH_KEY } from "../constants";
import { sanitizeRestorePath } from "../utils/last-app-path";
import {
  getPublicSidebarCollapsed,
  setPublicSidebarCollapsed as writePublicSidebarCollapsed,
} from "../utils/storage";

const SIDEKICK_SPLIT_STORAGE_KEY = "aura-sidekick-split";

function readPreviousPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sanitizeRestorePath(localStorage.getItem(PREVIOUS_PATH_KEY));
  } catch {
    return null;
  }
}

function writePreviousPath(path: string): void {
  if (typeof window === "undefined") return;
  try {
    const nextPath = sanitizeRestorePath(path);
    if (!nextPath) return;
    localStorage.setItem(PREVIOUS_PATH_KEY, nextPath);
  } catch {
    // ignore storage failures
  }
}

function readSidekickSplitScreen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SIDEKICK_SPLIT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidekickSplitScreen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      localStorage.setItem(SIDEKICK_SPLIT_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(SIDEKICK_SPLIT_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

type AppUIState = {
  visitedAppIds: Set<string>;
  sidebarQueries: Record<string, string>;
  sidebarActions: Record<string, ReactNode>;
  sidekickCollapsed: boolean;
  sidekickSplitScreen: boolean;
  /**
   * Whether the public-shell left sidebar is collapsed. Mirrors
   * `sidekickCollapsed` for the right side: a single boolean,
   * persisted to `localStorage`, toggled from a titlebar drawer
   * button (`<PanelLeft />` left, `<PanelRight />` right). Default
   * is `true` so first-visit logged-out users land on a clean
   * ChatGPT-style surface.
   */
  publicSidebarCollapsed: boolean;
  previousPath: string | null;

  markAppVisited: (appId: string) => void;
  setSidebarQuery: (appId: string, query: string) => void;
  setSidebarAction: (appId: string, node: ReactNode | null) => void;
  toggleSidekick: () => void;
  toggleSidekickSplitScreen: () => void;
  setSidekickSplitScreen: (value: boolean) => void;
  togglePublicSidebar: () => void;
  setPublicSidebarCollapsed: (value: boolean) => void;
  setPreviousPath: (path: string) => void;
};

export const useAppUIStore = create<AppUIState>()((set) => ({
  visitedAppIds: new Set<string>(),
  sidebarQueries: {},
  sidebarActions: {},
  sidekickCollapsed: false,
  sidekickSplitScreen: readSidekickSplitScreen(),
  publicSidebarCollapsed: getPublicSidebarCollapsed(),
  previousPath: readPreviousPath(),

  markAppVisited: (appId): void => {
    set((s) => {
      if (s.visitedAppIds.has(appId)) return s;
      const next = new Set(s.visitedAppIds);
      next.add(appId);
      return { visitedAppIds: next };
    });
  },

  setSidebarQuery: (appId, query): void => {
    set((s) => ({
      sidebarQueries: {
        ...s.sidebarQueries,
        [appId]: query,
      },
    }));
  },

  toggleSidekick: (): void => {
    set((s) => ({ sidekickCollapsed: !s.sidekickCollapsed }));
  },

  toggleSidekickSplitScreen: (): void => {
    set((s) => {
      const next = !s.sidekickSplitScreen;
      writeSidekickSplitScreen(next);
      return { sidekickSplitScreen: next };
    });
  },

  setSidekickSplitScreen: (value): void => {
    set((s) => {
      if (s.sidekickSplitScreen === value) return s;
      writeSidekickSplitScreen(value);
      return { sidekickSplitScreen: value };
    });
  },

  togglePublicSidebar: (): void => {
    set((s) => {
      const next = !s.publicSidebarCollapsed;
      writePublicSidebarCollapsed(next);
      return { publicSidebarCollapsed: next };
    });
  },

  setPublicSidebarCollapsed: (value): void => {
    set((s) => {
      if (s.publicSidebarCollapsed === value) return s;
      writePublicSidebarCollapsed(value);
      return { publicSidebarCollapsed: value };
    });
  },

  setPreviousPath: (path): void => {
    const nextPath = sanitizeRestorePath(path);
    if (!nextPath) return;
    writePreviousPath(nextPath);
    set({ previousPath: nextPath });
  },

  setSidebarAction: (appId, node): void => {
    set((s) => {
      if (node === null) {
        const nextSidebarActions = { ...s.sidebarActions };
        delete nextSidebarActions[appId];
        return { sidebarActions: nextSidebarActions };
      }
      return { sidebarActions: { ...s.sidebarActions, [appId]: node } };
    });
  },
}));
