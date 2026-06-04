/**
 * Persistence + DOM application for the Settings > Theme > Typography
 * controls (sans family, mono family, and a global text-size scale).
 *
 * Values are written as inline styles on `document.documentElement`, which
 * beat the `:root` / `[data-theme]` defaults by specificity (same approach as
 * `lib/theme-overrides.ts` and `lib/glass-level.ts`). The boot script in
 * `index.html` pre-stamps them before first paint to avoid a flash back to
 * the default Inter / 100% recipe.
 */

export type FontOption = {
  /** Stable id persisted to storage. */
  id: string;
  /** Human label for the picker. */
  label: string;
  /** Full CSS `font-family` stack applied to the document. */
  stack: string;
};

/**
 * Curated sans-serif families. The first entry mirrors the app default
 * (`--font-sans: 'Inter Variable'` in `index.css`). All stacks end in a
 * generic family so they degrade gracefully when a face is missing.
 */
export const SANS_FONTS: readonly FontOption[] = [
  { id: "inter", label: "Inter", stack: "'Inter Variable', 'Inter', system-ui, sans-serif" },
  { id: "system", label: "System", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: "geist", label: "Geist", stack: "'Geist', 'Inter Variable', system-ui, sans-serif" },
  { id: "serif", label: "Serif", stack: "Georgia, 'Times New Roman', 'Noto Serif', serif" },
];

/** Curated monospace families used for code blocks and the terminal. */
export const MONO_FONTS: readonly FontOption[] = [
  { id: "jetbrains", label: "JetBrains Mono", stack: "'JetBrains Mono', 'Fira Code', monospace" },
  { id: "fira", label: "Fira Code", stack: "'Fira Code', 'JetBrains Mono', monospace" },
  { id: "system", label: "System mono", stack: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, monospace" },
  { id: "courier", label: "Courier", stack: "'Courier New', Courier, monospace" },
];

export type Typography = {
  /** Selected sans font id (see {@link SANS_FONTS}). */
  sans: string;
  /** Selected mono font id (see {@link MONO_FONTS}). */
  mono: string;
  /** Text-size scale as a percentage (100 = default). */
  scale: number;
};

export const DEFAULT_TYPOGRAPHY: Typography = {
  sans: "inter",
  mono: "jetbrains",
  scale: 100,
};

export const TYPOGRAPHY_SCALE_MIN = 85;
export const TYPOGRAPHY_SCALE_MAX = 140;

/**
 * Base sizes (px) the scale multiplies. Mirrors the `--text-*` tokens in
 * `vendor/zui/src/styles/tokens.css` (all 12px today, but kept explicit so a
 * future non-uniform ramp scales correctly).
 */
const TEXT_TOKEN_BASES: Record<string, number> = {
  "--text-2xs": 12,
  "--text-xs": 12,
  "--text-sm": 12,
  "--text-base": 12,
  "--text-lg": 12,
  "--text-xl": 12,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clampTypographyScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TYPOGRAPHY.scale;
  return Math.min(
    TYPOGRAPHY_SCALE_MAX,
    Math.max(TYPOGRAPHY_SCALE_MIN, Math.round(value)),
  );
}

function resolveFontId(
  options: readonly FontOption[],
  id: unknown,
  fallback: string,
): string {
  if (typeof id === "string" && options.some((o) => o.id === id)) return id;
  return fallback;
}

export function sansStackFor(id: string): string {
  return (SANS_FONTS.find((o) => o.id === id) ?? SANS_FONTS[0]).stack;
}

export function monoStackFor(id: string): string {
  return (MONO_FONTS.find((o) => o.id === id) ?? MONO_FONTS[0]).stack;
}

const STORAGE_KEY = "aura-typography";

export function loadTypography(): Typography {
  if (typeof window === "undefined") return { ...DEFAULT_TYPOGRAPHY };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TYPOGRAPHY };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_TYPOGRAPHY };
    return {
      sans: resolveFontId(SANS_FONTS, parsed.sans, DEFAULT_TYPOGRAPHY.sans),
      mono: resolveFontId(MONO_FONTS, parsed.mono, DEFAULT_TYPOGRAPHY.mono),
      scale:
        typeof parsed.scale === "number"
          ? clampTypographyScale(parsed.scale)
          : DEFAULT_TYPOGRAPHY.scale,
    };
  } catch {
    return { ...DEFAULT_TYPOGRAPHY };
  }
}

export function saveTypography(state: Typography): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / privacy-mode storage: silently ignore so the UI stays
    // responsive. In-memory hook state remains the source of truth for the
    // current session.
  }
}

export function applyTypographyToDocument(state: Typography): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--font-sans", sansStackFor(state.sans));
  root.style.setProperty("--font-mono", monoStackFor(state.mono));
  const scale = clampTypographyScale(state.scale) / 100;
  for (const [token, base] of Object.entries(TEXT_TOKEN_BASES)) {
    root.style.setProperty(token, `${Math.round(base * scale)}px`);
  }
}
