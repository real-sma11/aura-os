import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme, type ResolvedTheme } from "@cypher-asi/zui";
import {
  applyOverridesToDocument,
  GLOBAL_TOKENS,
  loadOverrides,
  saveOverrides,
  type EditableToken,
  type StoredOverrides,
  type ThemeOverrides,
} from "../lib/theme-overrides";
import {
  createPresetId,
  loadPresets,
  parsePresetFromImport,
  savePresets,
  serializePresetForExport,
  type ImportResult,
  type StoredPresets,
  type ThemePreset,
} from "../lib/theme-presets";
import { api } from "../api/client";
import { useAuthStore } from "../stores/auth-store";

/**
 * Dispatched after the server hydration step writes a fresher
 * `StoredOverrides` into localStorage so any mounted hook instance can
 * re-read it without remounting. The detail is intentionally empty —
 * listeners reload via {@link loadOverrides} so there's one canonical
 * source of truth (localStorage), regardless of who triggered the event.
 */
const HYDRATED_EVENT = "aura-theme-overrides-hydrated";

/** Fire-and-forget PUT — UI already updated locally; failure is logged
 *  by the network layer and the next change re-pushes the full blob. */
function pushOverridesToServer(next: StoredOverrides): void {
  void api.preferences.putThemeOverrides(next).catch(() => {});
}

/** Single helper that both PRs of this hook agreed to use for every
 *  durable write: localStorage first (cheap, sync, sets up the next
 *  page load), then server PUT (cross-install survivability). */
function persistStore(next: StoredOverrides): void {
  saveOverrides(next);
  pushOverridesToServer(next);
}

let _hydrationUserId: string | null = null;

async function hydrateFromServer(): Promise<void> {
  let server: Awaited<ReturnType<typeof api.preferences.getThemeOverrides>>;
  try {
    server = await api.preferences.getThemeOverrides();
  } catch {
    // Server unavailable / 401 / etc. — keep local state as-is.
    return;
  }
  // "Meaningful data" guard mirrors PR 16's agent-order hydration:
  // a fresh-install server response is `{ dark: {}, light: {}, global: {} }`
  // and should NOT clobber the local working set the user may have
  // built up offline before the server got any data.
  const hasContent =
    Object.keys(server.global).length > 0 ||
    Object.keys(server.dark).length > 0 ||
    Object.keys(server.light).length > 0;
  if (!hasContent) return;
  const sanitized: StoredOverrides = {
    dark: { ...server.dark } as ThemeOverrides,
    light: { ...server.light } as ThemeOverrides,
    global: { ...server.global } as ThemeOverrides,
  };
  saveOverrides(sanitized);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(HYDRATED_EVENT));
  }
}

// Module-level subscription: server-hydrate the theme overrides once the
// user is identified, then again whenever the user identity changes
// (login swap, dev tooling). The `ThemeOverridesBridge` mounted in
// `main.tsx` ensures this module is loaded at app boot, so the
// subscription is registered before any auth event fires.
useAuthStore.subscribe((state) => {
  const userId = state.user?.user_id ?? null;
  if (userId === _hydrationUserId) return;
  _hydrationUserId = userId;
  if (!userId) return;
  void hydrateFromServer();
});

export type UseThemeOverridesResult = {
  /**
   * Currently-applied override map for the active resolved theme. Reflects
   * the active preset's overrides when one is selected, otherwise the
   * working set. Mutating it via {@link setToken} writes to whichever layer
   * is currently active (no-op for read-only built-in presets).
   */
  overrides: ThemeOverrides;
  /**
   * Working-set overrides for the dark theme (independent of which theme
   * is currently resolved). Useful for UIs that need to show both modes'
   * values simultaneously (e.g. the modal-background dual editor).
   */
  darkOverrides: ThemeOverrides;
  /** Working-set overrides for the light theme — see {@link darkOverrides}. */
  lightOverrides: ThemeOverrides;
  /**
   * Set or clear an editable token. When `targetTheme` is omitted (or
   * matches the active resolved theme), the call respects the active
   * preset (writing to it if editable, no-op for read-only built-ins).
   * When `targetTheme` is the OTHER mode, the write always targets that
   * mode's working-set entry, bypassing presets — the dual-mode editor
   * relies on this to dial in per-mode defaults regardless of which
   * preset (if any) is active for the visible theme.
   */
  setToken: (
    token: EditableToken,
    value: string | null,
    targetTheme?: ResolvedTheme,
  ) => void;
  resetAll: () => void;

  /** All presets that target the current resolved theme. */
  presets: ThemePreset[];
  /** Currently active preset id for the current resolved theme. */
  activePresetId: string | null;
  /** Selecting `null` falls back to the working set. */
  selectPreset: (id: string | null) => void;
  /**
   * Snapshot the currently-applied overrides into a new user preset and
   * select it as active. Returns the freshly-created preset.
   */
  createPresetFromCurrent: (name: string) => ThemePreset;
  /** No-op for read-only built-ins. */
  renamePreset: (id: string, name: string) => void;
  /** No-op for read-only built-ins. Falls back to working set if active. */
  deletePreset: (id: string) => void;
  /** Pretty JSON for download. Returns "" if the id is unknown. */
  exportPreset: (id: string) => string;
  /** Validates + adds a new preset from a JSON string. Does not auto-select. */
  importPreset: (raw: string) => ImportResult;
};

function emptyStore(): StoredOverrides {
  return { dark: {}, light: {}, global: {} };
}

function initialStore(): StoredOverrides {
  if (typeof window === "undefined") return emptyStore();
  return loadOverrides();
}

function initialPresets(): StoredPresets {
  return loadPresets();
}

/**
 * Single applicator + persistence layer for chrome-token customization. The
 * apply layer is preset-aware: when an active preset is set for the current
 * resolved theme, its `overrides` map wins; otherwise the working-set map
 * (persisted at `localStorage["aura-theme-overrides"]`) wins. There is
 * exactly one writer of `documentElement.style` for these tokens.
 */
export function useThemeOverrides(): UseThemeOverridesResult {
  const { resolvedTheme } = useTheme();
  const [store, setStore] = useState<StoredOverrides>(initialStore);
  const [presetState, setPresetState] =
    useState<StoredPresets>(initialPresets);

  const activePresetId = presetState.active[resolvedTheme];
  const activePreset = useMemo(() => {
    if (activePresetId === null) return undefined;
    return presetState.presets.find(
      (p) => p.id === activePresetId && p.base === resolvedTheme,
    );
  }, [activePresetId, presetState.presets, resolvedTheme]);

  // Base layer comes from the active preset (if any) or the per-theme
  // working set. Global tokens (e.g. icon-select accent) sit on top and
  // win unconditionally so switching theme / preset cannot silently
  // clear a personal accent the user set once.
  const baseOverrides: ThemeOverrides = activePreset
    ? activePreset.overrides
    : store[resolvedTheme];
  const appliedOverrides: ThemeOverrides = useMemo(
    () => ({ ...baseOverrides, ...store.global }),
    [baseOverrides, store.global],
  );

  useEffect(() => {
    applyOverridesToDocument(resolvedTheme, appliedOverrides);
  }, [resolvedTheme, appliedOverrides]);

  // Re-read localStorage whenever the module-level server hydration step
  // refreshes it. This is what makes a logged-in user see their saved
  // accent on a fresh install — server data lands in localStorage, the
  // event fires, mounted hook instances pick it up, the `appliedOverrides`
  // effect above re-runs, and the UI updates without a remount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setStore(loadOverrides());
    window.addEventListener(HYDRATED_EVENT, handler);
    return () => window.removeEventListener(HYDRATED_EVENT, handler);
  }, []);

  const setToken = useCallback(
    (
      token: EditableToken,
      value: string | null,
      targetTheme?: ResolvedTheme,
    ) => {
      // Global tokens ignore `targetTheme` and the active preset — they're
      // theme-independent by definition, so a single write lands in the
      // `global` slice and gets re-applied on every theme/preset change.
      if (GLOBAL_TOKENS.has(token)) {
        setStore((prev) => {
          const nextGlobal: ThemeOverrides = { ...prev.global };
          if (value === null) delete nextGlobal[token];
          else nextGlobal[token] = value;
          const next: StoredOverrides = { ...prev, global: nextGlobal };
          persistStore(next);
          return next;
        });
        return;
      }

      const effectiveTarget = targetTheme ?? resolvedTheme;
      const targetsActiveTheme = effectiveTarget === resolvedTheme;

      // Cross-theme writes (e.g. editing the light mode value while dark is
      // resolved) always target the working-set map for that theme. Presets
      // are scoped to a single base, so a dark preset never owns light-mode
      // overrides — writing to the working set keeps editing predictable.
      if (!targetsActiveTheme) {
        setStore((prev) => {
          const current = prev[effectiveTarget];
          const nextSide: ThemeOverrides = { ...current };
          if (value === null) delete nextSide[token];
          else nextSide[token] = value;
          const next: StoredOverrides = {
            ...prev,
            [effectiveTarget]: nextSide,
          };
          persistStore(next);
          return next;
        });
        return;
      }

      if (activePreset?.readOnly) return;

      if (activePreset) {
        const targetId = activePreset.id;
        setPresetState((prev) => {
          const nextPresets = prev.presets.map((p) => {
            if (p.id !== targetId) return p;
            const nextOverrides: ThemeOverrides = { ...p.overrides };
            if (value === null) delete nextOverrides[token];
            else nextOverrides[token] = value;
            return { ...p, overrides: nextOverrides };
          });
          const next: StoredPresets = { ...prev, presets: nextPresets };
          savePresets(next);
          return next;
        });
        return;
      }

      setStore((prev) => {
        const current = prev[resolvedTheme];
        const nextSide: ThemeOverrides = { ...current };
        if (value === null) delete nextSide[token];
        else nextSide[token] = value;
        const next: StoredOverrides = { ...prev, [resolvedTheme]: nextSide };
        persistStore(next);
        return next;
      });
    },
    [activePreset, resolvedTheme],
  );

  const resetAll = useCallback(() => {
    if (activePreset?.readOnly) return;

    if (activePreset) {
      const targetId = activePreset.id;
      setPresetState((prev) => {
        const nextPresets = prev.presets.map((p) =>
          p.id === targetId ? { ...p, overrides: {} } : p,
        );
        const next: StoredPresets = { ...prev, presets: nextPresets };
        savePresets(next);
        return next;
      });
      return;
    }

    setStore((prev) => {
      // "Reset all" clears global tokens too — they're cross-theme by
      // design, so a user who hits reset expects every personal accent
      // to revert, not just the active-theme ones.
      const next: StoredOverrides = {
        ...prev,
        [resolvedTheme]: {},
        global: {},
      };
      persistStore(next);
      return next;
    });
  }, [activePreset, resolvedTheme]);

  const selectPreset = useCallback(
    (id: string | null) => {
      setPresetState((prev) => {
        if (id !== null) {
          const ok = prev.presets.some(
            (p) => p.id === id && p.base === resolvedTheme,
          );
          if (!ok) return prev;
        }
        const next: StoredPresets = {
          ...prev,
          active: { ...prev.active, [resolvedTheme]: id },
        };
        savePresets(next);
        return next;
      });
    },
    [resolvedTheme],
  );

  const createPresetFromCurrent = useCallback(
    (name: string): ThemePreset => {
      const newPreset: ThemePreset = {
        id: createPresetId(),
        name,
        base: resolvedTheme,
        overrides: { ...appliedOverrides },
        version: 1,
      };
      setPresetState((prev) => {
        const next: StoredPresets = {
          ...prev,
          presets: [...prev.presets, newPreset],
          active: { ...prev.active, [resolvedTheme]: newPreset.id },
        };
        savePresets(next);
        return next;
      });
      return newPreset;
    },
    [appliedOverrides, resolvedTheme],
  );

  const renamePreset = useCallback((id: string, name: string) => {
    setPresetState((prev) => {
      const target = prev.presets.find((p) => p.id === id);
      if (!target || target.readOnly) return prev;
      const nextPresets = prev.presets.map((p) =>
        p.id === id ? { ...p, name } : p,
      );
      const next: StoredPresets = { ...prev, presets: nextPresets };
      savePresets(next);
      return next;
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresetState((prev) => {
      const target = prev.presets.find((p) => p.id === id);
      if (!target || target.readOnly) return prev;
      const nextPresets = prev.presets.filter((p) => p.id !== id);
      const nextActive = {
        dark: prev.active.dark === id ? null : prev.active.dark,
        light: prev.active.light === id ? null : prev.active.light,
      };
      const next: StoredPresets = {
        ...prev,
        presets: nextPresets,
        active: nextActive,
      };
      savePresets(next);
      return next;
    });
  }, []);

  const exportPreset = useCallback(
    (id: string): string => {
      const target = presetState.presets.find((p) => p.id === id);
      if (!target) return "";
      return serializePresetForExport(target);
    },
    [presetState.presets],
  );

  const importPreset = useCallback((raw: string): ImportResult => {
    const result = parsePresetFromImport(raw);
    if (!result.ok) return result;
    setPresetState((prev) => {
      const next: StoredPresets = {
        ...prev,
        presets: [...prev.presets, result.preset],
      };
      savePresets(next);
      return next;
    });
    return result;
  }, []);

  const presetsForTheme = useMemo(
    () => presetState.presets.filter((p) => p.base === resolvedTheme),
    [presetState.presets, resolvedTheme],
  );

  return {
    overrides: appliedOverrides,
    darkOverrides: store.dark,
    lightOverrides: store.light,
    setToken,
    resetAll,
    presets: presetsForTheme,
    activePresetId,
    selectPreset,
    createPresetFromCurrent,
    renamePreset,
    deletePreset,
    exportPreset,
    importPreset,
  };
}
