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
 * Unlike a sliding segmented control, the raised plate stays put and
 * tilts toward the active side — Agents presses the left edge down,
 * Projects presses the right edge down — simulating a physical rocker
 * via `rotateY` + `translateY` + a directional shadow shift, with the
 * pressed half darkened. Fully theme-aware: the soft light/dark shadow
 * tokens are rebound per `[data-theme]` so the plastic look reads
 * correctly in both light and dark mode.
 */
export function AppSwitchToggle({ active }: AppSwitchToggleProps): React.ReactElement {
  const navigate = useNavigate();

  return (
    <div className={styles.wrap}>
      <div
        className={styles.base}
        role="group"
        aria-label="Switch between Agents and Projects"
      >
        <div
          className={cn(
            styles.rocker,
            active === "agents" ? styles.rockerAgents : styles.rockerProjects,
          )}
        >
          {OPTIONS.map((option) => {
            const isActive = option.id === active;
            return (
              <button
                key={option.id}
                type="button"
                className={cn(styles.option, isActive && styles.optionActive)}
                aria-pressed={isActive}
                onClick={() => {
                  if (isActive) return;
                  navigate(option.path);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
