/**
 * Pins the deterministic mapping `deriveChatPalette` runs from a
 * persona's `siteBackgroundColor` into the chat-text + hljs
 * palette consumed by `MockAuraApp.module.css`'s
 * `[data-persona-themed="true"]` overrides.
 *
 * The tests intentionally lean on relational properties (text is
 * darker than a light bg, syntax tokens land at distinct hues)
 * rather than literal hex equality so the helper can be tuned
 * later without rewriting the suite.
 */

import { describe, expect, it } from "vitest";
import {
  deriveChatPalette,
  paletteToCssVars,
  type ChatPalette,
} from "./derive-chat-palette";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = parseInt(hex.replace("#", ""), 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  // Simple 0..1 perceived-lightness approximation — good enough
  // for the "is darker than" assertions; the helper uses a more
  // accurate HSL transform internally.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

describe("deriveChatPalette", () => {
  it("returns null when the input is null (NO_THEME personas keep defaults)", () => {
    expect(deriveChatPalette(null, "dark")).toBeNull();
    expect(deriveChatPalette(null, "light")).toBeNull();
  });

  it("returns null when the input is not a parseable hex", () => {
    expect(deriveChatPalette("not-a-hex", "dark")).toBeNull();
    expect(deriveChatPalette("#xyz", "dark")).toBeNull();
    expect(deriveChatPalette("", "dark")).toBeNull();
  });

  it("picks LIGHT text for dark theme so the bubble (dark in dark theme) stays readable", () => {
    // Solo Builder wallpaper is light dusty blue, but the bubble
    // paints dark in dark theme (via --color-surface), so the
    // text must be light regardless of the wallpaper lightness.
    const palette = deriveChatPalette("#b3c4d2", "dark");
    expect(palette).not.toBeNull();
    const p = palette as ChatPalette;
    expect(luminance(p.text)).toBeGreaterThan(0.75);
    // Hierarchy: primary brighter than secondary, brighter than muted.
    expect(luminance(p.text)).toBeGreaterThan(luminance(p.textSecondary));
    expect(luminance(p.textSecondary)).toBeGreaterThan(luminance(p.textMuted));
  });

  it("picks DARK text for light theme so the light bubble stays readable", () => {
    const palette = deriveChatPalette("#b3c4d2", "light");
    expect(palette).not.toBeNull();
    const p = palette as ChatPalette;
    expect(luminance(p.text)).toBeLessThan(0.3);
    expect(luminance(p.text)).toBeLessThan(luminance(p.textSecondary));
    expect(luminance(p.textSecondary)).toBeLessThan(luminance(p.textMuted));
  });

  it("renders every syntax token as a distinct hex value", () => {
    const palette = deriveChatPalette("#b3c4d2", "dark");
    expect(palette).not.toBeNull();
    const p = palette as ChatPalette;
    const tokenColors = new Set<string>([
      p.hljsKeyword,
      p.hljsString,
      p.hljsNumber,
      p.hljsComment,
      p.hljsType,
      p.hljsFunction,
    ]);
    // Six categories -> six distinct fills so the rendered snippet
    // doesn't collapse into a monochrome wall.
    expect(tokenColors.size).toBe(6);
  });

  it("keeps the input's hue family across the palette (text + syntax)", () => {
    // Wallpaper is cool dusty blue (~hue 208). Text token should
    // pull noticeably more blue than red; the comment token should
    // sit in the same cool family. A simple R<B sanity check is
    // enough to pin "we did not accidentally pick a warm palette".
    const p = deriveChatPalette("#b3c4d2", "dark") as ChatPalette;
    const textRgb = hexToRgb(p.text);
    expect(textRgb.b).toBeGreaterThan(textRgb.r);
    const commentRgb = hexToRgb(p.hljsComment);
    expect(commentRgb.b).toBeGreaterThanOrEqual(commentRgb.r);
  });

  it("is referentially stable for the same input", () => {
    // Not literal identity — `deriveChatPalette` builds a fresh
    // object on every call. The contract is that the *values* are
    // deterministic so the React tree can `useMemo` off the input
    // hex without state drift.
    expect(deriveChatPalette("#b3c4d2", "dark")).toEqual(
      deriveChatPalette("#b3c4d2", "dark"),
    );
    expect(deriveChatPalette("#b3c4d2", "light")).toEqual(
      deriveChatPalette("#b3c4d2", "light"),
    );
    // Dark and light variants differ — proves themeMode is used.
    expect(deriveChatPalette("#b3c4d2", "dark")).not.toEqual(
      deriveChatPalette("#b3c4d2", "light"),
    );
  });
});

describe("paletteToCssVars", () => {
  it("maps every palette field to its --mock-* custom property", () => {
    const palette = deriveChatPalette("#b3c4d2", "dark") as ChatPalette;
    const vars = paletteToCssVars(palette);
    expect(vars["--mock-text"]).toBe(palette.text);
    expect(vars["--mock-text-secondary"]).toBe(palette.textSecondary);
    expect(vars["--mock-text-muted"]).toBe(palette.textMuted);
    expect(vars["--mock-hljs-keyword"]).toBe(palette.hljsKeyword);
    expect(vars["--mock-hljs-string"]).toBe(palette.hljsString);
    expect(vars["--mock-hljs-number"]).toBe(palette.hljsNumber);
    expect(vars["--mock-hljs-comment"]).toBe(palette.hljsComment);
    expect(vars["--mock-hljs-type"]).toBe(palette.hljsType);
    expect(vars["--mock-hljs-function"]).toBe(palette.hljsFunction);
    // No stray keys outside the contract.
    expect(Object.keys(vars).sort()).toEqual(
      [
        "--mock-hljs-comment",
        "--mock-hljs-function",
        "--mock-hljs-keyword",
        "--mock-hljs-number",
        "--mock-hljs-string",
        "--mock-hljs-type",
        "--mock-text",
        "--mock-text-muted",
        "--mock-text-secondary",
      ].sort(),
    );
  });
});
