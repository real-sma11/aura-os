import { describe, it, expect, beforeEach } from "vitest";
import {
  readPersistedMode,
  selectEffectiveMode,
  useUIModeStore,
  type UIMode,
} from "./ui-mode-store";

const STORAGE_KEY = "aura-ui-mode";
const LEGACY_APP_MODE_KEY = "aura-app-mode";

beforeEach(() => {
  window.localStorage.clear();
  // Reset the store to a known starting value between tests so order
  // isn't load-bearing. The store reads `localStorage` once at module
  // load; later tests use `setMode` / `setState` to drive transitions.
  useUIModeStore.setState({ mode: "standard" });
});

describe("ui-mode-store", () => {
  describe("UIMode type round-trip", () => {
    it("accepts and persists each of the two values", () => {
      // `beforeEach` seeds `standard`, so lead with `public` to avoid a
      // no-op `setMode` short-circuit on the first iteration.
      const values: ReadonlyArray<UIMode> = ["public", "standard"];
      for (const value of values) {
        useUIModeStore.getState().setMode(value);
        expect(useUIModeStore.getState().mode).toBe(value);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe(value);
      }
    });
  });

  describe("readPersistedMode migrations", () => {
    it("returns 'standard' when nothing is persisted", () => {
      expect(readPersistedMode()).toBe("standard");
    });

    it("returns the persisted value when it matches the union", () => {
      window.localStorage.setItem(STORAGE_KEY, "standard");
      expect(readPersistedMode()).toBe("standard");
      window.localStorage.setItem(STORAGE_KEY, "public");
      expect(readPersistedMode()).toBe("public");
    });

    it("collapses the legacy 'simple' / 'advanced' / 'normie' values to 'standard'", () => {
      for (const legacy of ["simple", "advanced", "normie"]) {
        window.localStorage.setItem(STORAGE_KEY, legacy);
        expect(readPersistedMode()).toBe("standard");
      }
    });

    it("migrates legacy aura-app-mode='advanced' to 'standard' and removes the legacy key", () => {
      window.localStorage.setItem(LEGACY_APP_MODE_KEY, "advanced");
      expect(readPersistedMode()).toBe("standard");
      // The migration must consume the legacy key so it isn't read
      // a second time after the user explicitly chose a new value.
      expect(window.localStorage.getItem(LEGACY_APP_MODE_KEY)).toBeNull();
    });

    it("migrates legacy aura-app-mode='simple' to 'standard' and removes the legacy key", () => {
      window.localStorage.setItem(LEGACY_APP_MODE_KEY, "simple");
      expect(readPersistedMode()).toBe("standard");
      expect(window.localStorage.getItem(LEGACY_APP_MODE_KEY)).toBeNull();
    });

    it("falls back to 'standard' on garbage values", () => {
      window.localStorage.setItem(STORAGE_KEY, "wat");
      expect(readPersistedMode()).toBe("standard");
    });
  });

  describe("selectEffectiveMode", () => {
    it("logged-out users always see 'public'", () => {
      expect(selectEffectiveMode(false)).toBe("public");
    });

    it("logged-in users always see 'standard'", () => {
      expect(selectEffectiveMode(true)).toBe("standard");
    });
  });

  describe("setMode persistence", () => {
    it("persists each chosen mode to localStorage", () => {
      useUIModeStore.getState().setMode("public");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("public");
      useUIModeStore.getState().setMode("standard");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("standard");
    });

    it("is a no-op when the value is unchanged", () => {
      // Reset state and storage so we can observe whether a write lands.
      useUIModeStore.setState({ mode: "standard" });
      window.localStorage.removeItem(STORAGE_KEY);
      useUIModeStore.getState().setMode("standard");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});
