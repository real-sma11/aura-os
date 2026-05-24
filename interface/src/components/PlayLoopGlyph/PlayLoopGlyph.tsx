import styles from "./PlayLoopGlyph.module.css";

interface PlayLoopGlyphProps {
  /** `true` whenever the dev-loop is doing work and should advertise
   *  that visually. When `true` a rotating accent ring is drawn
   *  around the play; when `false` only the play glyph renders, so
   *  the icon collapses cleanly back to a static Play affordance. */
  active: boolean;
  /** Pixel size of the rendered SVG element. Matches the size you'd
   *  pass to `<Play size={...} />`; the ring extends *outside* this
   *  box (see `overflow: visible`) so the button physically stays
   *  the same width whether the loop is idle or active. Defaults
   *  to 14 to slot straight into the AutomationBar's iconOnly
   *  controls; the SidekickTaskbar Run tab passes 16. */
  size?: number;
  /** Optional accessible label for the active state. When provided,
   *  the ring SVG carries this as `aria-label`; in idle state the
   *  icon is `aria-hidden` because the button's own `title` already
   *  describes the affordance (Start/Resume) and we don't want a
   *  redundant announcement. Defaults to `"running"` so existing
   *  tests that locate the spinner by label keep working. */
  activeLabel?: string;
}

/**
 * Lucide Play glyph + an optional rotating progress ring, drawn in
 * **one SVG element** so the ring is guaranteed pixel-perfect
 * concentric with the play.
 *
 * Earlier iterations layered an absolutely-positioned ring SVG on
 * top of a separately-rendered `<Play>` lucide icon. Inside the zui
 * `Button` icon slot that overlay didn't anchor to its intended
 * wrap span and the two glyphs ended up rendering side-by-side
 * instead of stacking — you'd see "play triangle, then a broken
 * circle" instead of "play with a ring around it". Folding both
 * shapes into a single SVG removes the positioning concern
 * entirely: they share one coordinate system, one transform, one
 * accessible role.
 *
 * Geometry
 * --------
 * - `viewBox="0 0 24 24"` mirrors lucide's stock Play viewBox, so
 *   the play polygon path is the unchanged `"6 3 20 12 6 21 6 3"`.
 *   At any rendered `size`, the play glyph stays visually identical
 *   to a plain `<Play size={size} />`.
 * - The ring is centered at `(10.67, 12)` — the **centroid** of the
 *   play triangle rather than its bbox center. A right-pointing
 *   triangle has more visual weight on its left flat edge, so
 *   centering the ring on the centroid (not the bbox) lines the
 *   ring up with the perceived center of the play (the same trick
 *   YouTube/Spotify/Apple use for their circular play buttons).
 * - Ring radius is `16` viewBox units, which renders to ~9.3 px at
 *   `size=14` and ~10.7 px at `size=16`. That sits well outside the
 *   play's ~7-unit half-extent so the two never crowd each other.
 *   At r=16 the ring extends past the 24-unit viewBox, and the
 *   `style={{ overflow: 'visible' }}` declaration on the SVG lets
 *   it draw into the button's padding without enlarging the SVG
 *   element itself.
 * - A faint full background ring at the same radius gives the
 *   spinner a "track" to orbit. Without it the accent arc reads as
 *   a broken circle hovering next to the play; with it the brain
 *   parses the visual as "complete ring, brighter wedge moving
 *   around it", which is what users expect from a loading
 *   indicator.
 */
export function PlayLoopGlyph({
  active,
  size = 14,
  activeLabel = "running",
}: PlayLoopGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={active ? "img" : undefined}
      aria-label={active ? activeLabel : undefined}
      aria-hidden={active ? undefined : true}
      data-testid={active ? "play-loop-ring" : undefined}
      style={{ overflow: "visible" }}
    >
      <polygon points="6 3 20 12 6 21 6 3" />
      {active && (
        <g className={styles.ringGroup}>
          <circle
            cx={10.67}
            cy={12}
            r={16}
            stroke="currentColor"
            strokeOpacity={0.18}
            strokeWidth={1.25}
          />
          <circle
            cx={10.67}
            cy={12}
            r={16}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={100.53}
            strokeDashoffset={70.4}
            className={styles.ringArc}
          />
        </g>
      )}
    </svg>
  );
}
