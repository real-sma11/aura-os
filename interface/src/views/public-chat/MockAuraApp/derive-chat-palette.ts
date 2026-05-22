/**
 * Derives a self-consistent color palette for every piece of text
 * rendered inside the `MockAuraApp` frame — the DM bubble bodies,
 * the agent name labels, the tool-card target/preview, the
 * `TerminalStream` plain text, and the `hljs-*` syntax-highlight
 * tokens — from a single input hex (the active persona's
 * `siteBackgroundColor`).
 *
 * Why derive instead of hand-curate
 * ---------------------------------
 * Personas declare a wallpaper + a single dominant background
 * color (see `interface/src/views/public-chat/personas.ts`). The
 * mock chats sit on top of that wallpaper, so the chat palette
 * needs to coordinate with the persona's hue family. Computing
 * the palette from the bg keeps a new persona's authoring cost at
 * one color value — the chat picks up a complementary tone for
 * free.
 *
 * Strategy
 * --------
 * 1. Parse the hex to HSL — only the *hue* (and a damped
 *    saturation) is carried into the palette. The wallpaper bg's
 *    own lightness is intentionally ignored.
 * 2. Pick the contrast direction from the active shell theme
 *    (`themeMode`): the DM bubbles fill with `--color-surface` /
 *    `--color-elevated`, both of which track the theme rather
 *    than the wallpaper, so dark theme always paints dark
 *    translucent bubbles regardless of the wallpaper. Light text
 *    on dark bubbles (dark theme), dark text on light bubbles
 *    (light theme). Skipping this step produced unreadable
 *    dark-on-dark on Solo Builder in dark mode.
 * 3. Body text stays in the input's hue family with reduced
 *    saturation and a contrast-appropriate lightness.
 * 4. Syntax tokens fan out from the input hue (±60° / ±30° /
 *    180°) so each highlight.js category (keyword / string /
 *    number / type / function) reads as a discrete color while
 *    still landing inside the persona's overall palette.
 *
 * The helper is pure — no React, no DOM access — so it's safe to
 * call from any render path and is fully unit-testable.
 */

export interface ChatPalette {
  /** Primary body text — bubble content, terminal stream prose. */
  readonly text: string;
  /** Secondary text — titlebar names, tool target paths. */
  readonly textSecondary: string;
  /** Muted text — captions, the typing-indicator dots. */
  readonly textMuted: string;
  readonly hljsKeyword: string;
  readonly hljsString: string;
  readonly hljsNumber: string;
  readonly hljsComment: string;
  readonly hljsType: string;
  readonly hljsFunction: string;
}

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

const HEX_RE = /^#?([0-9a-f]{6})$/i;

function parseHexToHsl(hex: string): Hsl | null {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / d + 2) * 60;
      break;
    default:
      h = ((r - g) / d + 4) * 60;
      break;
  }
  return { h, s, l };
}

function hue2rgb(p: number, q: number, t: number): number {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number): string {
  const clampedS = Math.min(1, Math.max(0, s));
  const clampedL = Math.min(1, Math.max(0, l));
  const hue = (((h % 360) + 360) % 360) / 360;
  let r: number;
  let g: number;
  let b: number;
  if (clampedS === 0) {
    r = g = b = clampedL;
  } else {
    const q =
      clampedL < 0.5
        ? clampedL * (1 + clampedS)
        : clampedL + clampedS - clampedL * clampedS;
    const p = 2 * clampedL - q;
    r = hue2rgb(p, q, hue + 1 / 3);
    g = hue2rgb(p, q, hue);
    b = hue2rgb(p, q, hue - 1 / 3);
  }
  const toByte = (channel: number): string =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/**
 * Active shell theme — the DM bubbles fill with
 * `--color-surface` / `--color-elevated` (both theme-tracked)
 * regardless of the wallpaper, so the chat palette's contrast
 * direction must come from the theme, not the wallpaper. The
 * caller (`PublicChatView`) reads this from
 * `useTheme().resolvedTheme` (provided by `@cypher-asi/zui`),
 * matching how `HighlightThemeBridge` already swaps the global
 * hljs stylesheet on theme change.
 */
export type ThemeMode = "dark" | "light";

/**
 * Public entry point. Returns `null` for `null` / unparseable
 * inputs so the caller can fall straight back to the existing
 * shell theme tokens — `NO_THEME` personas don't override
 * anything inside the mock chats.
 */
export function deriveChatPalette(
  siteBackgroundHex: string | null,
  themeMode: ThemeMode,
): ChatPalette | null {
  if (!siteBackgroundHex) return null;
  const hsl = parseHexToHsl(siteBackgroundHex);
  if (!hsl) return null;
  const { h, s } = hsl;
  // Contrast direction comes from the shell theme (bubbles paint
  // dark in dark theme, light in light theme) — we deliberately
  // do NOT consult the wallpaper lightness here. See the file
  // comment for the readability trade-off this avoids.
  const isLightTheme = themeMode === "light";
  const textL = isLightTheme ? 0.14 : 0.9;
  const secondaryL = isLightTheme ? 0.3 : 0.78;
  const mutedL = isLightTheme ? 0.46 : 0.62;
  // Saturation for body text is bounded so a heavily saturated
  // wallpaper doesn't bleed into legibility. We also clamp the
  // floor so an effectively-grey input still picks up a hint of
  // its faint hue rather than rendering as a flat neutral.
  const textS = Math.min(0.4, Math.max(0.18, s + 0.05));
  const mutedS = Math.max(0.08, s * 0.5);
  // Syntax tokens lean a little brighter in dark theme so they
  // pop off the dark bubble; a little darker in light theme so
  // they don't wash out against the light bubble.
  const syntaxL = isLightTheme ? 0.34 : 0.7;
  const syntaxS = 0.5;
  const commentL = isLightTheme ? 0.52 : 0.58;
  return {
    text: hslToHex(h, textS, textL),
    textSecondary: hslToHex(h, Math.max(0.12, textS - 0.1), secondaryL),
    textMuted: hslToHex(h, mutedS, mutedL),
    hljsKeyword: hslToHex(h + 60, syntaxS, syntaxL),
    hljsString: hslToHex(h - 60, syntaxS, syntaxL),
    hljsNumber: hslToHex(h + 180, syntaxS, syntaxL),
    hljsComment: hslToHex(h, 0.12, commentL),
    hljsType: hslToHex(h - 30, syntaxS, syntaxL),
    hljsFunction: hslToHex(h + 30, syntaxS + 0.06, syntaxL),
  };
}

/**
 * Maps a `ChatPalette` onto the CSS custom property names that
 * `MockAuraApp.module.css`'s `[data-persona-themed="true"]` block
 * reads. Lives next to `deriveChatPalette` so the call site that
 * picks the property names stays in one place — the React
 * component just spreads the result into `style={...}`.
 */
export function paletteToCssVars(
  palette: ChatPalette,
): Record<string, string> {
  return {
    "--mock-text": palette.text,
    "--mock-text-secondary": palette.textSecondary,
    "--mock-text-muted": palette.textMuted,
    "--mock-hljs-keyword": palette.hljsKeyword,
    "--mock-hljs-string": palette.hljsString,
    "--mock-hljs-number": palette.hljsNumber,
    "--mock-hljs-comment": palette.hljsComment,
    "--mock-hljs-type": palette.hljsType,
    "--mock-hljs-function": palette.hljsFunction,
  };
}
