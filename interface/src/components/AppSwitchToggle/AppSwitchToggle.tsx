import { startTransition, useEffect, useState } from "react";
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
 * `.panel` (the seam). The two halves fill the panel: the idle half is a
 * flat fill, while the selected half gets a diagonal gradient fill, an
 * accent glow flaring up-and-outward, a directional gradient border, and a
 * large black shadow cast down-and-outward. The foundation never changes
 * size when the selection flips.
 */
export function AppSwitchToggle({ active }: AppSwitchToggleProps): React.ReactElement {
  const navigate = useNavigate();

  // Flip the visual selection optimistically on click so the switch feels
  // instant, instead of waiting for `navigate` to mount the target app and
  // push down a new `active` prop. The pending value clears once the real
  // route catches up.
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
          role="group"
          aria-label="Switch between Agents and Projects"
        >
          {OPTIONS.map((option) => {
            const isActive = option.id === selected;
            return (
              <button
                key={option.id}
                type="button"
                className={cn(
                  styles.half,
                  option.id === "agents" ? styles.halfLeft : styles.halfRight,
                  isActive ? styles.halfActive : styles.halfIdle,
                )}
                aria-pressed={isActive}
                onClick={() => {
                  if (isActive) return;
                  // Urgent: flip the switch now so it paints immediately.
                  setPending(option.id);
                  // Non-urgent: defer the heavier route swap so it doesn't
                  // block the optimistic flip from painting first.
                  startTransition(() => {
                    navigate(option.path);
                  });
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
