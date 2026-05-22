import { useUIModeStore, type UIMode } from "../../stores/ui-mode-store";
import styles from "./ModeToggle.module.css";

const SEGMENTS: ReadonlyArray<{ id: UIMode; label: string }> = [
  { id: "normie", label: "Normie" },
  { id: "advanced", label: "Advanced" },
];

/**
 * Two-segment pill toggle for the global UI complexity mode. Lives at
 * the top-left of every sidebar (under the search input) so users can
 * flip between the simplified public/Normie surface and the full
 * Advanced shell from any app.
 */
export function ModeToggle() {
  const mode = useUIModeStore((s) => s.mode);
  const setMode = useUIModeStore((s) => s.setMode);

  return (
    <div className={styles.root} role="group" aria-label="Interface mode">
      {SEGMENTS.map(({ id, label }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
            aria-pressed={active}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
