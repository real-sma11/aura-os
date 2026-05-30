import { useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { bugReportsApi, type BugReportDto } from "../api/bug-reports";

interface BugReportsState {
  items: readonly BugReportDto[];
  selectedId: string | null;
  isLoading: boolean;
  hasLoaded: boolean;
  loadError: string | null;
  loadItems: () => Promise<void>;
  selectItem: (id: string | null) => void;
}

export const useBugReportsStore = create<BugReportsState>()((set, get) => ({
  items: [],
  selectedId: null,
  isLoading: false,
  hasLoaded: false,
  loadError: null,

  loadItems: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, loadError: null });
    try {
      const items = await bugReportsApi.list();
      set((state) => ({
        items,
        isLoading: false,
        hasLoaded: true,
        selectedId:
          state.selectedId && items.some((r) => r.id === state.selectedId)
            ? state.selectedId
            : (items[0]?.id ?? null),
      }));
    } catch (err) {
      set({
        isLoading: false,
        hasLoaded: true,
        loadError:
          err instanceof Error ? err.message : "Failed to load bug reports.",
      });
    }
  },

  selectItem: (selectedId) => set({ selectedId }),
}));

/**
 * Bootstraps the bug-report list on mount. Call once from a component that
 * lives for the lifetime of the Bug Reports app. Idempotent across mounts so
 * navigating away and back reuses the cached list.
 */
export function useBugReportsBootstrap(): void {
  useEffect(() => {
    const { hasLoaded, isLoading, loadItems } = useBugReportsStore.getState();
    if (hasLoaded || isLoading) return;
    void loadItems();
  }, []);
}

export function useBugReports() {
  return useBugReportsStore(
    useShallow((s) => ({
      items: s.items,
      selectedId: s.selectedId,
      selectItem: s.selectItem,
      isLoading: s.isLoading,
      hasLoaded: s.hasLoaded,
      loadError: s.loadError,
    })),
  );
}

export function useSelectedBugReport(): BugReportDto | null {
  return useBugReportsStore((s) =>
    s.selectedId === null
      ? null
      : (s.items.find((r) => r.id === s.selectedId) ?? null),
  );
}
