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
   * Optional `object-position` override for the wallpaper `<img>`
   * inside the `MockAuraApp` frame. The wallpaper is rendered with
   * `object-fit: cover`, so the image is scaled to fill the 16:10
   * rectangle and the overflowing axis is cropped. The default
   * (`null`) leaves the browser default of `50% 50%` — center-
   * cropped on both axes — which is correct for most wallpapers.
   *
   * Set this when a curated portrait needs a non-centered crop —
   * e.g. a head-and-shoulders shot whose subject is in the upper
   * third of the source asset and would otherwise get sliced
   * mid-chest by the default center crop. Any valid CSS
   * `object-position` value works (`"center 20%"`,
   * `"50% top"`, two-keyword forms, etc.).
   */
  readonly desktopBackgroundPosition: string | null;
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
  desktopBackgroundPosition: null,
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
      desktopBackgroundPosition: null,
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
  {
    id: "coordinator",
    name: "Coordinator",
    theme: {
      desktopBackgroundUrl: "/personas/coordinator/desktop.png",
      // The source portrait is a tall 3:4 frame (helmet + upper
      // torso). Center-cropped into the 16:10 wallpaper it slices
      // mid-chest; pulling the crop window up keeps the helmeted
      // head fully framed and trims the awkward chest cut from the
      // default 50% position. 35% lands halfway between the prior
      // 20% and the default — a softer shift that still avoids the
      // mid-chest slice but keeps more of the upper torso visible.
      desktopBackgroundPosition: "center 35%",
      // No surrounding site image — the page paints a solid lavender
      // wash behind the `MockAuraApp` rectangle so the helmeted
      // portrait sits on a flat saturated field.
      siteBackgroundUrl: null,
      siteBackgroundColor: "#B06AB3",
      // The lavender wash is mid-tone but still bright enough that
      // the default near-white nav/tick tokens lose contrast against
      // it. Mirror the `solo-builder` approach: near-black for the
      // active/hover state, a slightly lighter near-black for idle,
      // so the marketing footer (bottom-left links) and right-edge
      // tick rail keep a legible two-step hierarchy on the bg.
      siteForegroundColor: "#0a0a0a",
      siteForegroundColorMuted: "#1a1a1a",
    },
  },
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
