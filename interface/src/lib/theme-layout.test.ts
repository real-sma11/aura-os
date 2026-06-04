import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyLayoutToDocument,
  DEFAULT_LAYOUT,
  loadLayout,
  saveLayout,
} from "./theme-layout";

const STORAGE_KEY = "aura-layout";

describe("theme-layout", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-density");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-density");
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("round-trips a saved value", () => {
    saveLayout({ radius: "round", density: "compact" });
    expect(loadLayout()).toEqual({ radius: "round", density: "compact" });
  });

  it("falls back to defaults for invalid values", () => {
    saveLayout({
      radius: "bogus" as never,
      density: "bogus" as never,
    });
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("falls back to defaults when JSON is malformed", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("applies radius + control-height tokens and the density attribute", () => {
    applyLayoutToDocument({ radius: "round", density: "compact" });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--radius-md")).toBe("12px");
    expect(style.getPropertyValue("--control-height-sm")).toBe("28px");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("applies sharp/comfortable defaults", () => {
    applyLayoutToDocument({ radius: "sharp", density: "comfortable" });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--radius-md")).toBe("0");
    expect(style.getPropertyValue("--control-height-sm")).toBe("32px");
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "comfortable",
    );
  });
});
