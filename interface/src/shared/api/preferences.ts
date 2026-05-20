import { apiFetch } from "./core";

/**
 * Per-user theme-token overrides — the writable side of
 * `Settings → Appearance → Custom colors` plus the
 * `Icon select accent` section. Mirrors `StoredOverrides` from
 * `interface/src/lib/theme-overrides.ts`; round-tripped opaquely by
 * the server so frontend schema changes don't require Rust edits.
 *
 * - `dark` / `light` — per-resolved-theme working set, keyed by CSS
 *   custom-property name.
 * - `global` — tokens whose value is the same in both resolved
 *   themes (e.g. `--color-icon-selected`), so switching dark ↔ light
 *   doesn't drop them.
 */
export interface ThemeOverridesPrefs {
  dark: Record<string, string>;
  light: Record<string, string>;
  global: Record<string, string>;
}

export const preferencesApi = {
  getThemeOverrides: (): Promise<ThemeOverridesPrefs> =>
    apiFetch("/api/preferences/theme-overrides"),

  putThemeOverrides: (
    prefs: ThemeOverridesPrefs,
  ): Promise<ThemeOverridesPrefs> =>
    apiFetch("/api/preferences/theme-overrides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }),
};
