/**
 * Source of truth for the six agent personas surfaced on the public
 * landing surface (`PublicChatView`) via the right-edge
 * `PersonaTickRail`. Each entry pairs a stable id + display name
 * with an optional visual theme that re-skins the public landing
 * the moment the visitor hovers, focuses, or clicks the matching
 * tick.
 *
 * The shape is intentionally pure data — no React, no DOM — so
 * adding a new persona or swapping a theme is a one-line edit to
 * `PERSONAS` below. Theme assets live under
 * `interface/public/personas/<id>/` and are referenced by absolute
 * URL so Vite serves them directly without bundling.
 *
 * Adding a persona / theme
 * ------------------------
 * 1. Drop the wallpaper image at
 *    `interface/public/personas/<persona-id>/desktop.png` and the
 *    page-level background at
 *    `interface/public/personas/<persona-id>/site.png` (or any
 *    extension Vite knows about).
 * 2. Append a `{ id, name, theme: { ... } }` entry to `PERSONAS`.
 * 3. The rail picks up the new tick automatically — the tick rail
 *    renders one tick per `PERSONAS` entry, so the visible column
 *    grows with the array.
 *
 * Leaving any theme field as `null` keeps the existing default for
 * that surface (e.g. `desktopBackgroundUrl: null` keeps the
 * `MockAuraApp` video loop in place; `siteBackgroundColor: null`
 * keeps the shell's normal page color).
 */

export interface PersonaTheme {
  /**
   * Static image URL painted as the wallpaper inside the
   * `MockAuraApp` frame. When `null`, `MockAuraApp` falls back to
   * the default `/AURA_visual_loop.mp4` video loop.
   */
  readonly desktopBackgroundUrl: string | null;
  /**
   * Static image URL painted as the page background behind the
   * whole `PublicChatView` (i.e. the area surrounding the
   * `MockAuraApp` rectangle). Applied via inline `background-image`
   * on the `.chatView` container with `cover` sizing.
   */
  readonly siteBackgroundUrl: string | null;
  /**
   * Solid color paired with `siteBackgroundUrl` — paints under the
   * image so the page never flashes the shell color while the
   * static asset is still loading. Also serves as the sole site
   * background when `siteBackgroundUrl` is `null`.
   */
  readonly siteBackgroundColor: string | null;
  /**
   * Strong foreground color (active / hover) for chrome that floats
   * over the persona's site background — currently the active tick
   * in `PersonaTickRail` and the hovered link in
   * `PublicSidebarFooter`. When `null` the default
   * `--color-text-primary` paints, which is correct for dark / video
   * backgrounds. Set to a hard contrast value (e.g. `#1a1a1a`) for
   * personas whose `siteBackgroundUrl` is light enough that the
   * default near-white token washes out.
   *
   * Published as the `--public-nav-fg-color` custom property on
   * `document.documentElement` while the persona is active so the
   * marketing footer (a sibling outside `PublicChatView`'s subtree)
   * can read the same value.
   */
  readonly siteForegroundColor: string | null;
  /**
   * Muted foreground color (idle) paired with `siteForegroundColor`.
   * Used by idle ticks and idle marketing links so the existing two-
   * level hierarchy (secondary -> primary on hover/active) survives a
   * persona contrast override. When `null` the default
   * `--color-text-secondary` paints.
   *
   * Published as `--public-nav-fg-color-muted` on
   * `document.documentElement` while the persona is active.
   */
  readonly siteForegroundColorMuted: string | null;
}

export interface Persona {
  /**
   * Stable kebab-case id. Used as the asset folder name under
   * `interface/public/personas/<id>/` and as a React list key so
   * renaming `name` never reorders existing personas.
   */
  readonly id: string;
  /** Display label shown inside the rail's hover panel. */
  readonly name: string;
  /** Visual override applied when this persona is the active tick. */
  readonly theme: PersonaTheme;
}

const NO_THEME: PersonaTheme = {
  desktopBackgroundUrl: null,
  siteBackgroundUrl: null,
  siteBackgroundColor: null,
  siteForegroundColor: null,
  siteForegroundColorMuted: null,
};

export const PERSONAS: ReadonlyArray<Persona> = [
  { id: "vibecoder", name: "Vibecoder", theme: NO_THEME },
  {
    id: "solo-builder",
    name: "Solo Builder",
    theme: {
      desktopBackgroundUrl: "/personas/solo-builder/desktop.png",
      siteBackgroundUrl: "/personas/solo-builder/site.png",
      // Sampled from the dominant mid-tone of `site.png` so the page
      // paints a matching dusty-blue immediately on first paint and
      // there is no dark flash before the image finishes loading.
      siteBackgroundColor: "#b3c4d2",
      // The dusty-blue site is light enough that the default
      // near-white nav/tick tokens wash out. Override with a near-
      // black pair so the marketing footer links and the right-edge
      // tick column stay legible — strong for active/hover, muted
      // for idle. Both are intentionally close to pure black; the
      // 16-point gap is just enough hierarchy for the hover state
      // to read without sacrificing idle legibility on the bg.
      siteForegroundColor: "#0a0a0a",
      siteForegroundColorMuted: "#1a1a1a",
    },
  },
  { id: "giga-brain", name: "Giga Brain", theme: NO_THEME },
  { id: "coordinator", name: "Coordinator", theme: NO_THEME },
  { id: "researcher", name: "Researcher", theme: NO_THEME },
  { id: "cypher-punk", name: "Cypher Punk", theme: NO_THEME },
];

/**
 * Convenience accessor — clamps the requested index into the
 * `PERSONAS` range and returns the matching persona. Used by the
 * `PublicChatView` orchestrator to look up the active theme.
 */
export function getPersonaAt(index: number): Persona {
  if (PERSONAS.length === 0) {
    throw new Error("PERSONAS array is empty");
  }
  const clamped = Math.min(Math.max(index, 0), PERSONAS.length - 1);
  return PERSONAS[clamped];
}
