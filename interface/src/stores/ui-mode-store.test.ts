import { describe, it, expect, beforeEach } from "vitest";
import {
  readPersistedMode,
  selectEffectiveMode,
  useUIModeStore,
  type UIMode,
  type UIModeState,
} from "./ui-mode-store";

const STORAGE_KEY = "aura-ui-mode";
const LEGACY_APP_MODE_KEY = "aura-app-mode";

beforeEach(() => {
  window.localStorage.clear();
  // Reset the store to a known starting value between tests so order
  // isn't load-bearing. The store reads `localStorage` once at module
  // load; later tests use `setMode` / `setState` to drive transitions.
  useUIModeStore.setState({ mode: "simple" });
});

describe("ui-mode-store", () => {
  describe("UIMode type round-trip", () => {
    it("accepts and persists each of the three values", () => {
      const values: ReadonlyArray<UIMode> = ["advanced", "public", "simple"];
      for (const value of values) {
        useUIModeStore.getState().setMode(value);
        expect(useUIModeStore.getState().mode).toBe(value);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe(value);
      }
    });
  });

  describe("readPersistedMode migrations", () => {
    it("returns 'simple' when nothing is persisted", () => {
      expect(readPersistedMode()).toBe("simple");
    });

    it("returns the persisted value when it matches the union", () => {
      window.localStorage.setItem(STORAGE_KEY, "advanced");
      expect(readPersistedMode()).toBe("advanced");
      window.localStorage.setItem(STORAGE_KEY, "public");
      expect(readPersistedMode()).toBe("public");
    });

    it("migrates the legacy 'normie' value to 'simple'", () => {
      window.localStorage.setItem(STORAGE_KEY, "normie");
      expect(readPersistedMode()).toBe("simple");
    });

    it("migrates legacy aura-app-mode='advanced' to seed advanced and removes the legacy key", () => {
      window.localStorage.setItem(LEGACY_APP_MODE_KEY, "advanced");
      expect(readPersistedMode()).toBe("advanced");
      // The migration must consume the legacy key so it isn't read
      // a second time after the user explicitly chose a new value.
      expect(window.localStorage.getItem(LEGACY_APP_MODE_KEY)).toBeNull();
    });

    it("migrates legacy aura-app-mode='simple' to seed simple and removes the legacy key", () => {
      window.localStorage.setItem(LEGACY_APP_MODE_KEY, "simple");
      expect(readPersistedMode()).toBe("simple");
      expect(window.localStorage.getItem(LEGACY_APP_MODE_KEY)).toBeNull();
    });

    it("falls back to 'simple' on garbage values", () => {
      window.localStorage.setItem(STORAGE_KEY, "wat");
      expect(readPersistedMode()).toBe("simple");
    });
  });

  describe("selectEffectiveMode truth table", () => {
    function effective(mode: UIMode, isAuthenticated: boolean): UIMode {
      const state: UIModeState = {
        mode,
        setMode: () => {},
        toggleMode: () => {},
      };
      return selectEffectiveMode(state, isAuthenticated);
    }

    it("logged-out users always see 'public' regardless of stored preference", () => {
      expect(effective("simple", false)).toBe("public");
      expect(effective("advanced", false)).toBe("public");
      expect(effective("public", false)).toBe("public");
    });

    it("logged-in users see their stored 'simple' / 'advanced' preference", () => {
      expect(effective("simple", true)).toBe("simple");
      expect(effective("advanced", true)).toBe("advanced");
    });

    it("logged-in users with a stale 'public' preference are squashed to 'simple'", () => {
      expect(effective("public", true)).toBe("simple");
    });
  });

  describe("setMode persistence", () => {
    it("persists each chosen mode to localStorage", () => {
      useUIModeStore.getState().setMode("advanced");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("advanced");
      useUIModeStore.getState().setMode("simple");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("simple");
      useUIModeStore.getState().setMode("public");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("public");
    });

    it("is a no-op when the value is unchanged", () => {
      // Reset state and storage so we can observe whether a write lands.
      useUIModeStore.setState({ mode: "advanced" });
      window.localStorage.removeItem(STORAGE_KEY);
      useUIModeStore.getState().setMode("advanced");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("setMode('public') while logged in: store persists 'public' but selectEffectiveMode squashes to 'simple'", () => {
      useUIModeStore.getState().setMode("public");
      expect(useUIModeStore.getState().mode).toBe("public");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("public");
      expect(selectEffectiveMode(useUIModeStore.getState(), true)).toBe(
        "simple",
      );
    });
  });

  describe("toggleMode", () => {
    it("flips between simple and advanced", () => {
      useUIModeStore.setState({ mode: "simple" });
      useUIModeStore.getState().toggleMode();
      expect(useUIModeStore.getState().mode).toBe("advanced");
      useUIModeStore.getState().toggleMode();
      expect(useUIModeStore.getState().mode).toBe("simple");
    });

    it("persists each flip", () => {
      useUIModeStore.setState({ mode: "simple" });
      useUIModeStore.getState().toggleMode();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("advanced");
      useUIModeStore.getState().toggleMode();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("simple");
    });
  });
});
