import { useMemo } from "react";
import { useUIModeStore, type UIMode } from "../../stores/ui-mode-store";
import { SlidingPills, type SlidingPillItem } from "../SlidingPills";
import styles from "./ModeToggle.module.css";

const ITEMS: ReadonlyArray<SlidingPillItem<UIMode>> = [
  { id: "normie", label: "Normie", title: "Simplified public chat surface" },
  { id: "advanced", label: "Advanced", title: "Full app shell" },
];

/**
 * Two-segment pill toggle for the global UI complexity mode. Lives at
 * the top-left of every sidebar (under the search input) so users can
 * flip between the simplified public/Normie surface and the full
 * Advanced shell from any app.
 *
 * Built on `SlidingPills` so the slide animation, accessibility
 * semantics (`role="radiogroup"` / `role="radio"`), and keyboard
 * navigation all match the agent input's `ModeSelector` (Code / Plan
 * / Image / Video / 3D), making the two controls feel like one
 * family.
 */
export function ModeToggle() {
  const mode = useUIModeStore((s) => s.mode);
  const setMode = useUIModeStore((s) => s.setMode);

  const items = useMemo(() => ITEMS, []);

  return (
    <div className={styles.root} data-agent-surface="ui-mode-toggle">
      <SlidingPills
        items={items}
        value={mode}
        onChange={setMode}
        ariaLabel="Interface mode"
        className={styles.pills}
        segmentClassName={styles.segment}
        indicatorClassName={styles.indicator}
      />
    </div>
  );
}
