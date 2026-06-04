import { useNavigate } from "react-router-dom";
import { cn } from "@cypher-asi/zui";
import styles from "./AppSwitchToggle.module.css";

export type AppSwitchOptionId = "agents" | "projects";

interface AppSwitchOption {
  id: AppSwitchOptionId;
  label: string;
  path: string;
}

const OPTIONS: readonly AppSwitchOption[] = [
  { id: "agents", label: "Agents", path: "/agents" },
  { id: "projects", label: "Projects", path: "/projects" },
];

export interface AppSwitchToggleProps {
  /** Which side of the switch reads as "on". */
  active: AppSwitchOptionId;
}

/**
 * Neumorphic rocker switch that toggles between the Agents and Projects
 * apps. Lives at the top of the shared sidebar body for both apps.
 *
 * Modeled as a center-folding rocker rather than a rigid tilting plate:
 * the two halves are hinged at the center seam. The selected half lies
 * flat and frontal in the plane of the cradle; the unselected half folds
 * back from the seam like a ramp, foreshortening under a shared scene
 * perspective. This is the only model that yields a genuinely flat
 * selected face with a skewed opposite face.
 *
 * Fully theme-aware: the soft light/dark shadow + plate tokens are
 * rebound per `[data-theme]` so the plastic look reads correctly in
 * both light and dark mode.
 */
export function AppSwitchToggle({ active }: AppSwitchToggleProps): React.ReactElement {
  const navigate = useNavigate();

  return (
    <div className={styles.wrap}>
      <div className={styles.scene}>
        <div
          className={styles.cradle}
          role="group"
          aria-label="Switch between Agents and Projects"
        >
          <div className={styles.rocker}>
            {OPTIONS.map((option) => {
              const isActive = option.id === active;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    styles.half,
                    option.id === "agents" ? styles.halfLeft : styles.halfRight,
                    isActive ? styles.halfActive : styles.halfFolded,
                  )}
                  aria-pressed={isActive}
                  onClick={() => {
                    if (isActive) return;
                    navigate(option.path);
                  }}
                >
                  <span className={styles.label}>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
