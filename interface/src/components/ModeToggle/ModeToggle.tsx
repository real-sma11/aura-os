import { useCallback, useMemo } from "react";
import { useUIModeStore, type UIMode } from "../../stores/ui-mode-store";
import { useEffectiveMode } from "../../stores/use-effective-mode";
import { SlidingPills, type SlidingPillItem } from "../SlidingPills";
import styles from "./ModeToggle.module.css";

/**
 * The pill toggle is a binary control over the two persistable
 * authenticated modes; `"public"` is derived from auth and never
 * written by this control.
 */
type ToggleMode = Exclude<UIMode, "public">;

const ITEMS: ReadonlyArray<SlidingPillItem<ToggleMode>> = [
  { id: "simple", label: "Simple", title: "Simplified chat surface" },
  { id: "advanced", label: "Advanced", title: "Full app shell" },
];

/**
 * Two-segment pill toggle for the global UI complexity mode. Lives at
 * the top-left of every sidebar (under the search input) so users can
 * flip between the simplified Simple chat surface and the full
 * Advanced shell from any app.
 *
 * Built on `SlidingPills` so the slide animation, accessibility
 * semantics (`role="radiogroup"` / `role="radio"`), and keyboard
 * navigation all match the agent input's `ModeSelector` (Code / Plan
 * / Image / Video / 3D), making the two controls feel like one
 * family.
 *
 * In **public** (logged-out) mode the toggle stays mounted at the
 * same DOM identity but is rendered inert: the wrapper carries
 * `aria-disabled` and `pointer-events: none`, and writes are
 * suppressed at the change handler. The same `SlidingPills` instance
 * is reused across every mode flip — Phase 3's load-bearing
 * invariant is that the `lastAppliedValueRef` inside `SlidingPills`
 * survives across flips so the indicator *slides* (rather than
 * snaps) on every Simple <-> Advanced toggle. Wrapping with
 * `key={mode}` would remount and reset that ref; we deliberately
 * don't.
 */
export function ModeToggle(): React.ReactElement {
  const mode = useUIModeStore((s) => s.mode);
  const setMode = useUIModeStore((s) => s.setMode);
  const effectiveMode = useEffectiveMode();
  const isInert = effectiveMode === "public";

  const items = useMemo(() => ITEMS, []);
  // The store's `mode` carries the full `UIMode` union (including
  // `"public"`), but the toggle only ever pictures `simple`/`advanced`.
  // When the persisted value is `"public"` (logged-out users, or a
  // stale write), we still want the indicator to land on a valid
  // segment; default to `"simple"`, matching `selectEffectiveMode`'s
  // squash for logged-in `"public"`.
  const value: ToggleMode = mode === "advanced" ? "advanced" : "simple";

  const handleChange = useCallback(
    (next: ToggleMode): void => {
      if (isInert) return;
      setMode(next);
    },
    [isInert, setMode],
  );

  return (
    <div
      className={styles.root}
      data-agent-surface="ui-mode-toggle"
      data-inert={isInert || undefined}
      aria-disabled={isInert || undefined}
      style={isInert ? { pointerEvents: "none", opacity: 0.6 } : undefined}
    >
      <SlidingPills
        items={items}
        value={value}
        onChange={handleChange}
        ariaLabel="Interface mode"
        className={styles.pills}
        segmentClassName={styles.segment}
        indicatorClassName={styles.indicator}
        indicatorTestId="ui-mode-indicator"
      />
    </div>
  );
}
