import type { ResolvedTheme } from "@cypher-asi/zui";

/**
 * Ordered list of CSS custom properties users can override from the
 * Settings > Appearance editor (phase 7). The accent token is included
 * alongside the chrome tokens so power users can dial in an off-palette
 * accent without waiting for phase 8's named presets. All of these are
 * applied as inline `document.documentElement.style` rules, which beat
 * anything declared on `:root` / `[data-theme='...']` by specificity.
 */
export const EDITABLE_TOKENS = [
  "--color-border",
  "--color-border-main-panel",
  "--color-border-chrome",
  "--color-surface-tint",
  "--color-elevated-tint",
  "--color-sidebar-bg",
  "--color-sidekick-bg",
  "--color-titlebar-bg",
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-muted",
  "--color-accent-contrast",
  "--color-surface",
  "--color-elevated",
  "--color-modal-bg",
  "--color-card-line",
] as const;

export type EditableToken = (typeof EDITABLE_TOKENS)[number];

/** Per-token override values. Missing keys mean "use default". */
export type ThemeOverrides = Partial<Record<EditableToken, string>>;

/** Stored shape: independent overrides for dark vs light. */
export type StoredOverrides = {
  dark: ThemeOverrides;
  light: ThemeOverrides;
};

const STORAGE_KEY = "aura-theme-overrides";

const EDITABLE_TOKEN_SET: ReadonlySet<string> = new Set(EDITABLE_TOKENS);

function emptyStore(): StoredOverrides {
  return { dark: {}, light: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeOverrides(raw: unknown): ThemeOverrides {
  if (!isRecord(raw)) return {};
  const out: ThemeOverrides = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    if (!EDITABLE_TOKEN_SET.has(key)) continue;
    out[key as EditableToken] = value;
  }
  return out;
}

export function loadOverrides(): StoredOverrides {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyStore();
    return {
      dark: sanitizeOverrides(parsed.dark),
      light: sanitizeOverrides(parsed.light),
    };
  } catch {
    return emptyStore();
  }
}

export function saveOverrides(next: StoredOverrides): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded / privacy-mode storage: silently ignore so the UI
    // stays responsive. The in-memory hook state remains the source of
    // truth for the current session.
  }
}

/**
 * Writes the given override map onto `document.documentElement.style`,
 * setting properties that are present and REMOVING properties that are
 * absent so switching resolved themes (or resetting) doesn't leak values
 * from the previous set.
 *
 * The `resolved` argument is currently unused at the CSS level (the
 * overrides win via specificity regardless of `data-theme`) but is kept
 * in the signature so future versions can namespace storage or animate
 * transitions without a breaking API change.
 */
export function applyOverridesToDocument(
  _resolved: ResolvedTheme,
  overrides: ThemeOverrides,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const token of EDITABLE_TOKENS) {
    const value = overrides[token];
    if (typeof value === "string" && value.length > 0) {
      root.style.setProperty(token, value);
    } else {
      root.style.removeProperty(token);
    }
  }
}

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[-0-9.%,\s/]+\s*\)$/i;
const NAMED_RE = /^[a-z]+$/i;

/**
 * Lightweight CSS color validator. Accepts `#rgb` / `#rgba` /
 * `#rrggbb` / `#rrggbbaa`, functional `rgb()` / `rgba()` / `hsl()` /
 * `hsla()` notation, and named colors. This is intentionally not
 * exhaustive — it exists to reject obvious garbage before we write to
 * `element.style` (where the browser would silently drop it anyway).
 */
export function isValidColorValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (HEX_RE.test(trimmed)) return true;
  if (FUNC_RE.test(trimmed)) return true;
  if (NAMED_RE.test(trimmed)) return true;
  return false;
}

/** Accent token set derived from a single custom hex (see {@link deriveAccent}). */
export type DerivedAccent = {
  "--color-accent": string;
  "--color-accent-hover": string;
  "--color-accent-muted": string;
  "--color-accent-contrast": string;
};

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const part = (n: number) => clampChannel(n).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Expands a single accent hex into the full accent token set the way ZUI's
 * `[data-accent]` palettes do: a darker hover, a translucent "muted" fill, and
 * a black/white contrast color chosen by perceived luminance. Used by the
 * Settings > Theme custom-accent picker so users can dial in an off-palette
 * accent that still feels cohesive across hover/active/contrast states.
 *
 * Returns null for non-hex input so callers can ignore mid-typing values.
 */
export function deriveAccent(hex: string): DerivedAccent | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const hover = {
    r: rgb.r * 0.82,
    g: rgb.g * 0.82,
    b: rgb.b * 0.82,
  };
  // Perceived luminance (sRGB-weighted) picks readable text over the accent.
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const contrast = luminance > 0.6 ? "#000000" : "#ffffff";
  return {
    "--color-accent": toHex(rgb),
    "--color-accent-hover": toHex(hover),
    "--color-accent-muted": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
    "--color-accent-contrast": contrast,
  };
}
