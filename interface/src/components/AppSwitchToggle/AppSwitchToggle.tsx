import { useEffect, useState } from "react";
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
 * Flat, plate-mounted toggle between the Agents and Projects apps. Lives at
 * the top of the shared sidebar body for both apps.
 *
 * The foundation is a fixed-size gradient `.plate` holding a recessed
 * `.panel` track. A single `.thumb` carries the selected look and slides
 * between the two sides via a composited `transform` transition, so the
 * animation is fully independent of the rest of the page's render work.
 *
 * The selection is tracked optimistically so the thumb starts sliding the
 * instant a side is clicked, rather than waiting for `navigate` to mount the
 * target app and push down a new `active` prop.
 */
export function AppSwitchToggle({ active }: AppSwitchToggleProps): React.ReactElement {
  const navigate = useNavigate();

  const [pending, setPending] = useState<AppSwitchOptionId | null>(null);
  const selected = pending ?? active;

  useEffect(() => {
    if (pending === active) setPending(null);
  }, [pending, active]);

  return (
    <div className={styles.wrap}>
      <div className={styles.plate}>
        <div
          className={styles.panel}
          data-selected={selected}
          role="group"
          aria-label="Switch between Agents and Projects"
        >
          <span className={styles.thumb} aria-hidden="true" />
          {OPTIONS.map((option) => {
            const isActive = option.id === selected;
            return (
              <button
                key={option.id}
                type="button"
                className={cn(styles.half, isActive && styles.halfActive)}
                aria-pressed={isActive}
                onClick={() => {
                  if (isActive) return;
                  // Slide the thumb now; navigate right away. The slide is a
                  // composited transform, so it keeps animating smoothly even
                  // while the route mounts the target app.
                  setPending(option.id);
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
  );
}
