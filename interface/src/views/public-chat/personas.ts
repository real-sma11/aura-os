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
   * inside the `MockAuraApp` frame. Only meaningful when
   * `desktopBackgroundFit` resolves to `"cover"` (the default) —
   * `contain` mode never crops, so `object-position` only nudges
   * a letterboxed image within its bars (rarely useful). The
   * default (`null`) leaves the browser default of `50% 50%` —
   * center-cropped on both axes — which is correct for most
   * wallpapers.
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
   * `object-fit` mode for the wallpaper `<img>`. Defaults to
   * `"cover"` when `null` — the image fills the 16:10 mock
   * window, cropping whichever axis overflows. Switch to
   * `"contain"` when the source is a tall portrait (or any other
   * non-16:10 asset) that you want to display in full instead of
   * cropping; pair it with `desktopBackgroundColor` set to the
   * dominant tone of the image so the letterbox bars blend with
   * the artwork's own background.
   */
  readonly desktopBackgroundFit: "cover" | "contain" | null;
  /**
   * Solid color painted behind the wallpaper `<img>` inside the
   * `MockAuraApp` frame. Defaults to the frame's own near-black
   * fill when `null`. Pair this with
   * `desktopBackgroundFit: "contain"` and a sampled match of the
   * image's natural background so the letterbox bars left by
   * `contain` mode look like an extension of the artwork rather
   * than dark bands cutting it off.
   */
  readonly desktopBackgroundColor: string | null;
  /**
   * Multiplier applied as a `transform: scale(N)` on the wallpaper
   * `<img>` to zoom the rendered image in (>1) or out (<1) from
   * its baseline `object-fit` size. Defaults to no transform when
   * `null` (i.e. the image renders at its natural `cover`/`contain`
   * size). Use values like `1.2` to push the figure a notch
   * larger inside a `contain`-fit wallpaper without re-cropping
   * the source asset. `.appFrame` carries `overflow: hidden` so
   * scaled-up content is clipped cleanly to the mock window
   * rectangle.
   */
  readonly desktopBackgroundScale: number | null;
  /**
   * Static image URL painted as the page background behind the
   * whole `PublicChatView` (i.e. the area surrounding the
   * `MockAuraApp` rectangle). Applied via inline `background-image`
   * on the `.chatView` container with `cover` sizing.
   */
  readonly siteBackgroundUrl: string | null;
  /**
   * Solid color paired with `siteBackgroundUrl` — paints under the
   * image so the page never flashes the shell color while the asset
   * is still loading. Also serves as the sole site background when
   * `siteBackgroundUrl` is `null`.
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
  /**
   * Neon accent color used for the landing CTA's glowing border and
   * bloom shadow (the "Create your agent" pill in `PublicChatView`).
   * Published as `--public-cta-glow-color` on `.chatView` while this
   * persona is active so only the CTA reads it. When `null` the CSS
   * default — a neon violet matching the reference — paints, which
   * is correct for personas with a dark / video site background.
   *
   * Override on personas whose `siteBackgroundColor` would wash out
   * the default violet: pick a hue that pops off the page bg (warm
   * accent on cool washes, cool accent on warm washes). The glow is
   * the only surface that consumes this value, so changing it never
   * affects the rail, the marketing footer, or the chat palette.
   */
  readonly siteCtaGlowColor: string | null;
  /**
   * Per-persona crop hint for the bottom-left avatar dock inside
   * `MockAuraApp`. The dock reuses `desktopBackgroundUrl` as the
   * avatar image and zooms ~2x via `background-size: 200%`, so a
   * `background-position` value here decides which slice of the
   * source portrait lands in the 18px circle. When `null` the dock
   * falls back to `"50% 18%"` — the upper-third sweet spot where
   * the head sits in every existing character portrait.
   *
   * NO_THEME personas don't paint an avatar image at all (they
   * render an initial-letter fallback instead), so this field is
   * ignored for them.
   */
  readonly avatarObjectPosition: string | null;
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
  desktopBackgroundFit: null,
  desktopBackgroundColor: null,
  desktopBackgroundScale: null,
  siteBackgroundUrl: null,
  siteBackgroundColor: null,
  siteForegroundColor: null,
  siteForegroundColorMuted: null,
  siteCtaGlowColor: null,
  avatarObjectPosition: null,
};

export const PERSONAS: ReadonlyArray<Persona> = [
  {
    id: "vibecoder",
    name: "Vibecoder",
    theme: {
      // Cyberpunk portrait fills the mock desktop window's
      // wallpaper rectangle. The source is a 1024×1024 square
      // head-and-shoulders shot of the AURA-jacket character on
      // a saturated pink field. The figure was authored at the
      // image's natural center (head leans slightly right, body
      // slightly left — natural pose with negligible net
      // horizontal offset), so no asset pre-processing is needed
      // to keep the visor centered inside the wallpaper window.
      //
      // Uses the same shape as the other curated personas
      // (`solo-builder`, `coordinator`): default `cover` fit
      // with an `object-position` tweak to control which slice
      // survives the vertical crop. Sharing one fit mode across
      // personas means switching ticks cross-fades cleanly
      // between two correctly-positioned wallpapers (the fade
      // is driven by `MockAuraApp`) instead of jumping between
      // `contain` + scale + frame-bg-color overrides.
      desktopBackgroundUrl: "/personas/vibecoder/desktop.png",
      // Position is irrelevant under `contain` (the image fits
      // entirely inside the frame and there is no crop axis to
      // anchor). Leave null and document the fact rather than
      // setting a misleading value that suggests the position
      // does something here.
      desktopBackgroundPosition: null,
      // `contain` shows the full source vertically: the
      // 1024×1024 square fits to the frame's 1000px height and
      // the leftover ~600px of frame width becomes horizontal
      // letterbox bars. Switched from `cover` because that mode
      // was cropping ~37% of the source's height to fill the
      // frame width — the user explicitly wants the figure read
      // end-to-end top to bottom.
      desktopBackgroundFit: "contain",
      // Matches the sampled hot-pink corners of the source
      // (~`#ea3580`). With `contain` fit it paints the
      // horizontal letterbox bars on either side of the
      // centered image; the source's own pink bg then appears
      // to extend seamlessly to the window edges instead of
      // revealing the default near-black appFrame fill behind
      // the bars.
      desktopBackgroundColor: "#ea3580",
      // Zoom in 10% from the `contain` baseline. The painted
      // contain rectangle (1000×1000 inside a 1600×1000 frame)
      // scales to 1100×1100 around the frame center: the figure
      // grows 10% larger, the horizontal letterbox bars shrink
      // from 300px to 250px each side, and a ~4.5% slice at
      // the top / bottom of the source falls outside the frame
      // and gets trimmed by `.appFrame`'s `overflow: hidden`.
      // The matching pink bg above still fills the (narrower)
      // letterbox bars so the seam stays invisible.
      desktopBackgroundScale: 1.1,
      // Deep purple-violet gradient with diagonal light streaks
      // painted as the page bg behind the mock desktop window —
      // the cool atmospheric backdrop offsets the hot pink
      // portrait inside the window without competing for
      // attention.
      siteBackgroundUrl: "/personas/vibecoder/site.png",
      // Mid-tone of the gradient (sampled from the image's
      // center band) so the page paints a matching deep purple
      // immediately on first paint and there is no dark flash
      // before the static asset finishes loading.
      siteBackgroundColor: "#2a0258",
      // The deep-purple bg is dark and high-contrast, so the
      // default near-white nav/tick foreground tokens already
      // read cleanly — leave both overrides null so the shell
      // defaults paint through.
      siteForegroundColor: null,
      siteForegroundColorMuted: null,
      // CTA keeps the default neon-violet bloom which is tuned
      // to pop against the deep purple page bg.
      siteCtaGlowColor: null,
      // Default `50% 18%` framing keeps the visor + face centered
      // inside the 18px circle once the dock zooms in 2x on the
      // 1024x1024 source — the figure was authored with the head
      // near the top so no per-persona override is needed.
      avatarObjectPosition: null,
    },
  },
  {
    id: "solo-builder",
    name: "Solo Builder",
    theme: {
      desktopBackgroundUrl: "/personas/solo-builder/desktop.png",
      // Position is irrelevant under `contain` (the image fits
      // entirely inside the frame and there is no crop axis to
      // anchor). Same shape as Vibecoder / Cypher Punk below.
      desktopBackgroundPosition: null,
      // `contain` shows the full source vertically: the
      // 1024×1024 square fits to the frame's 1000px height and
      // the leftover ~600px of frame width becomes horizontal
      // letterbox bars. Matches Vibecoder + Cypher Punk so the
      // figure renders at the same visible size across all three
      // character-portrait personas — cross-fading between them
      // is a clean image dissolve with no size jump.
      desktopBackgroundFit: "contain",
      // Sampled midpoint of the source's left/right edges,
      // which run from `#7ea2b0` at the top to `#7195a5` at the
      // bottom in a gentle vertical gradient. `#7a9eac` sits
      // right in the middle of that range, so the seam between
      // the letterbox bar and any image edge stays imperceptible
      // along the full height of the frame.
      desktopBackgroundColor: "#7a9eac",
      // Zoom OUT 15% from the `contain` baseline — intentionally
      // different from Vibecoder + Cypher Punk's `1.1`. The
      // Vibecoder + Cypher Punk source PNGs frame their subject
      // edge-to-edge (hair / hood touch the top of the source,
      // shoulders reach the bottom), so `1.1` makes those figures
      // fill the rendered frame as a tight head-and-shoulders
      // portrait. The Solo Builder source, in contrast, authors
      // the helmeted figure as a much smaller element with a
      // wide band of sky above and around it — at `1.1` the
      // visor floats small and high in the upper third of the
      // frame instead of reading as a comparable portrait.
      //
      // Contracting to `0.85` does double duty: the figure
      // shrinks (the "zoom out" half of the user's request) AND
      // the visor falls visibly closer to frame center (the
      // "move down" half), because scaling shrinks everything
      // toward the element's center and the visor was sitting
      // above it. The resulting widened bg-color border on all
      // four sides reads as deliberate negative space rather
      // than as a small head in an oversized window.
      desktopBackgroundScale: 0.85,
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
      // Warm coral accent contrasts cleanly against the dusty-blue
      // site bg so the CTA's neon border + bloom read as a separate
      // light source instead of melting into the page color.
      siteCtaGlowColor: "#ff7a59",
      // Default framing — the helmeted figure is centered in the
      // 1024x1024 source with the helmet brim near the top edge,
      // so the shared `50% 18%` slice lands the visor on the
      // vertical centerline of the 18px avatar circle.
      avatarObjectPosition: null,
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
      desktopBackgroundFit: null,
      desktopBackgroundColor: null,
      desktopBackgroundScale: null,
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
      // Cyan accent so the CTA's neon glow sits opposite the
      // lavender page wash on the color wheel — the default neon
      // violet would disappear into the bg here.
      siteCtaGlowColor: "#5ce0ff",
      // The portrait source is a tall 3:4 frame (helmet + upper
      // torso) so the head naturally sits higher than on the
      // square sources. Default `50% 18%` slice still lands the
      // helmet centered in the 18px avatar circle.
      avatarObjectPosition: null,
    },
  },
  { id: "researcher", name: "Researcher", theme: NO_THEME },
  {
    id: "cypher-punk",
    name: "Cypher Punk",
    theme: {
      // Hooded operator with a green-lit neon visor on a pure-
      // black field. The source is a 1024×1024 square — same
      // aspect as the Vibecoder portrait — so the wallpaper
      // framing inherits the same `cover`-fit math (scaled to
      // fill the 16:10 frame width, ~37% of height cropped).
      //
      // `center 20%` pushes the crop window high in the source
      // so the visible content slides DOWN inside the mock
      // window: with the default center crop the visor sat in
      // the upper-third of the frame and the top of the hood
      // got clipped; pinning at 20% exposes more of the hood
      // top and lands the visor + face on the vertical
      // centerline of the wallpaper window, making the face
      // read as the focal point instead of feeling pushed up
      // against the titlebar.
      desktopBackgroundUrl: "/personas/cypher-punk/desktop.png",
      // Same shape as Vibecoder above: `contain` shows the full
      // source vertically, with the matching black bg filling
      // the horizontal letterbox bars so the figure's natural
      // black backdrop appears to extend to the window edges.
      // Position is null because `contain` has no crop axis to
      // anchor — the prior `"center 20%"` was a `cover`-mode
      // nudge that became a no-op when we switched to `contain`,
      // so it's been dropped rather than left as misleading
      // dead code.
      desktopBackgroundPosition: null,
      desktopBackgroundFit: "contain",
      // Matches the wallpaper's near-pure-black corners
      // (sampled at #030303).
      desktopBackgroundColor: "#030303",
      // Zoom in 10% from the `contain` baseline — matches the
      // Vibecoder scale exactly so the two personas (which share
      // a 1024×1024 source) render the figure at the same
      // visible 1100×1100 size, keeping the cross-fade between
      // them a clean dissolve with no size jump.
      desktopBackgroundScale: 1.1,
      // No surrounding site image — the page paints a flat dark
      // blue-gray wash behind the `MockAuraApp` rectangle so the
      // pure-black wallpaper inside the window reads as a darker
      // inset against the slightly lighter page bg.
      siteBackgroundUrl: null,
      siteBackgroundColor: "#22272E",
      // Page bg is dark and high-contrast, so the default near-
      // white nav/tick foreground tokens already read cleanly.
      siteForegroundColor: null,
      siteForegroundColorMuted: null,
      // Spring-green / cyan-lifted neon sampled from the helmet
      // visor stripes in the wallpaper portrait — slightly cooler
      // than a pure matrix `#39ff14` so it tracks the actual
      // emissive green inside the mock window. The CTA's border +
      // bloom inherit it via `--public-cta-glow-color`, so the
      // "Create your agent" pill reads as if lit by the same
      // visor light source against the dark blue-gray page bg.
      siteCtaGlowColor: "#3aff8a",
      // Default framing — the hooded operator's visor sits in the
      // upper third of the 1024x1024 source, so the shared
      // `50% 18%` slice lands the visor centered in the 18px
      // avatar circle.
      avatarObjectPosition: null,
    },
  },
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
