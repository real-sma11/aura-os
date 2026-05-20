import styles from "./CheckLoopGlyph.module.css";

interface CheckLoopGlyphProps {
  /** `true` whenever a task loop is doing work and should advertise
   *  that visually. When `true` a rotating accent ring is drawn
   *  around the check; when `false` only the check glyph renders, so
   *  the icon collapses cleanly back to a static Tasks affordance. */
  active: boolean;
  /** Pixel size of the rendered SVG element. Matches the size you'd
   *  pass to `<Check size={...} />`; the ring extends *outside* this
   *  box (see `overflow: visible`) so the button physically stays the
   *  same width whether the tab is idle or active. Defaults to 16 to
   *  match the SidekickTaskbar Tasks tab. */
  size?: number;
  /** Optional accessible label for the active state. When provided,
   *  the ring SVG carries this as `aria-label`; in idle state the
   *  icon is `aria-hidden` because the button's own `title` already
   *  describes the affordance (Tasks) and we don't want a redundant
   *  announcement. Defaults to `"running"` so existing tests that
   *  locate the spinner by label keep working. */
  activeLabel?: string;
}

/**
 * Lucide Check glyph + an optional rotating progress ring, drawn in
 * **one SVG element** so the ring is guaranteed pixel-perfect
 * concentric with the check.
 *
 * This is the Tasks-tab sibling of `PlayLoopGlyph`. The two share
 * the same geometry and CSS pattern so the Run and Tasks tabs in the
 * sidekick top nav look like a matched pair when their respective
 * loops are active: same ring radius, same accent stroke, same
 * spinner animation, same idle/active swap behaviour. Earlier the
 * Tasks tab replaced its check icon entirely with a bare
 * `LoopProgress` spinner, which made the tab harder to recognise
 * while it was busy and broke visual parity with Run.
 *
 * Geometry
 * --------
 * - `viewBox="0 0 24 24"` mirrors lucide's stock Check viewBox, so
 *   the polyline points `"20 6 9 17 4 12"` are the unchanged lucide
 *   path. At any rendered `size`, the check glyph stays visually
 *   identical to a plain `<Check size={size} />`.
 * - The ring is centered at `(12, 11.5)` — close to the check's
 *   bounding-box center and its perceived visual center. The check
 *   is roughly symmetric across its diagonal so the bbox centre is
 *   already a good match; we nudge `cy` up half a unit so the ring
 *   doesn't sit visibly low under the down-stroke of the tick.
 * - Ring radius is `16` viewBox units to match `PlayLoopGlyph`, so
 *   the Tasks and Run tabs render rings of identical size. At r=16
 *   the ring extends past the 24-unit viewBox, and the
 *   `style={{ overflow: 'visible' }}` declaration on the SVG lets it
 *   draw into the button's padding without enlarging the SVG element
 *   itself.
 * - A faint full background ring at the same radius gives the
 *   spinner a "track" to orbit, matching `PlayLoopGlyph` exactly.
 */
export function CheckLoopGlyph({
  active,
  size = 16,
  activeLabel = "running",
}: CheckLoopGlyphProps) {
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
      data-testid={active ? "check-loop-ring" : undefined}
      style={{ overflow: "visible" }}
    >
      <polyline points="20 6 9 17 4 12" />
      {active && (
        <g className={styles.ringGroup}>
          <circle
            cx={12}
            cy={11.5}
            r={16}
            stroke="currentColor"
            strokeOpacity={0.18}
            strokeWidth={1.25}
          />
          <circle
            cx={12}
            cy={11.5}
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
