import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyTypographyToDocument,
  clampTypographyScale,
  DEFAULT_TYPOGRAPHY,
  loadTypography,
  monoStackFor,
  sansStackFor,
  saveTypography,
  TYPOGRAPHY_SCALE_MAX,
  TYPOGRAPHY_SCALE_MIN,
} from "./theme-typography";

const STORAGE_KEY = "aura-typography";

describe("theme-typography", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadTypography()).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it("round-trips a saved value", () => {
    saveTypography({ sans: "system", mono: "fira", scale: 120 });
    expect(loadTypography()).toEqual({ sans: "system", mono: "fira", scale: 120 });
  });

  it("falls back to defaults for unknown font ids", () => {
    saveTypography({ sans: "nope", mono: "nope", scale: 100 });
    const loaded = loadTypography();
    expect(loaded.sans).toBe(DEFAULT_TYPOGRAPHY.sans);
    expect(loaded.mono).toBe(DEFAULT_TYPOGRAPHY.mono);
  });

  it("falls back to defaults when JSON is malformed", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadTypography()).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it("clamps the scale into range", () => {
    expect(clampTypographyScale(10)).toBe(TYPOGRAPHY_SCALE_MIN);
    expect(clampTypographyScale(999)).toBe(TYPOGRAPHY_SCALE_MAX);
    expect(clampTypographyScale(Number.NaN)).toBe(DEFAULT_TYPOGRAPHY.scale);
  });

  it("resolves font stacks with safe fallbacks", () => {
    expect(sansStackFor("inter")).toContain("Inter");
    expect(sansStackFor("does-not-exist")).toBe(sansStackFor("inter"));
    expect(monoStackFor("jetbrains")).toContain("JetBrains");
    expect(monoStackFor("does-not-exist")).toBe(monoStackFor("jetbrains"));
  });

  it("applies font + scaled text tokens to the document", () => {
    applyTypographyToDocument({ sans: "system", mono: "fira", scale: 150 });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-sans")).toContain("system-ui");
    expect(style.getPropertyValue("--font-mono")).toContain("Fira Code");
    // 150 clamps to 140 -> round(12 * 1.4) = 17px.
    expect(style.getPropertyValue("--text-sm")).toBe("17px");
  });
});
