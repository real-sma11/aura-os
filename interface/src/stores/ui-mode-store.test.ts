import { describe, it, expect, beforeEach } from "vitest";
import { useUIModeStore } from "./ui-mode-store";

const STORAGE_KEY = "aura-ui-mode";

beforeEach(() => {
  window.localStorage.clear();
  useUIModeStore.setState({ mode: "advanced" });
});

describe("ui-mode-store", () => {
  it("defaults to 'advanced' when no value is persisted", () => {
    expect(useUIModeStore.getState().mode).toBe("advanced");
  });

  describe("setMode", () => {
    it("updates the in-memory mode", () => {
      useUIModeStore.getState().setMode("normie");
      expect(useUIModeStore.getState().mode).toBe("normie");
    });

    it("persists the chosen mode to localStorage", () => {
      useUIModeStore.getState().setMode("normie");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("normie");

      useUIModeStore.getState().setMode("advanced");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("advanced");
    });

    it("is a no-op when the value is unchanged", () => {
      useUIModeStore.getState().setMode("advanced");
      // No write should land for an unchanged value (storage stays empty).
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe("toggleMode", () => {
    it("flips between normie and advanced", () => {
      useUIModeStore.getState().toggleMode();
      expect(useUIModeStore.getState().mode).toBe("normie");
      useUIModeStore.getState().toggleMode();
      expect(useUIModeStore.getState().mode).toBe("advanced");
    });

    it("persists each flip", () => {
      useUIModeStore.getState().toggleMode();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("normie");
      useUIModeStore.getState().toggleMode();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("advanced");
    });
  });
});
