import { create } from "zustand";

/**
 * Per-context sidebar search query store.
 *
 * Phase 3 lifts the public-mode `LoggedOutShell` search-query
 * `useState` and (in spirit) the per-app `useSidebarSearch` query
 * into a single store so the typed value survives mode flips. With
 * `AuraShell` mounted once across `simple` / `advanced` / `public`,
 * the chrome stays in the DOM through every flip — but local
 * component state would still reset on a body swap. Persisting the
 * query in zustand here means the user can type "hello", flip
 * Simple <-> Advanced (or Public -> Simple after login), and the
 * input value stays "hello".
 *
 * Keyed by an arbitrary string (`"public"`, an app id like `"chat"`,
 * `"agents"`, etc.) so each surface keeps its own query independent.
 * The existing per-app `useAppUIStore.sidebarQueries` is the
 * authoritative store for authenticated app surfaces; this store
 * owns the public-mode query that has no `useActiveApp` to key off.
 */
export interface SidebarSearchState {
  queries: Record<string, string>;
  setQuery: (key: string, value: string) => void;
  clearQuery: (key: string) => void;
}

export const useSidebarSearchStore = create<SidebarSearchState>()((set) => ({
  queries: {},
  setQuery: (key, value): void => {
    set((s) => {
      if (s.queries[key] === value) return s;
      return { queries: { ...s.queries, [key]: value } };
    });
  },
  clearQuery: (key): void => {
    set((s) => {
      if (!(key in s.queries)) return s;
      const next = { ...s.queries };
      delete next[key];
      return { queries: next };
    });
  },
}));

/**
 * Convenience selector for components that want a single
 * `[value, setValue]` pair scoped to a particular key.
 */
export function useSidebarSearchQuery(key: string): [string, (value: string) => void] {
  const value = useSidebarSearchStore((s) => s.queries[key] ?? "");
  const setQuery = useSidebarSearchStore((s) => s.setQuery);
  return [value, (next: string): void => setQuery(key, next)];
}
