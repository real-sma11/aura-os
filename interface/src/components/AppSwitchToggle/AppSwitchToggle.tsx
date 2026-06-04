import { memo, useEffect, useState } from "react";
import { cn } from "@cypher-asi/zui";
import styles from "./AppSwitchToggle.module.css";

export interface AppSwitchOption {
  id: string;
  label: string;
}

export interface AppSwitchToggleProps {
  /** The two sides of the switch. The first two entries drive the slide. */
  options: readonly AppSwitchOption[];
  /** Id of the currently-selected option. */
  active: string;
  /** Fired with the option id when the user picks the inactive side. */
  onChange: (id: string) => void;
  /** Accessible label for the group. */
  ariaLabel?: string;
}

/**
 * Flat, plate-mounted two-up toggle. Fully generic: it knows nothing
 * about routing or which apps it switches between — the caller owns the
 * options and the `onChange` side effect.
 *
 * The foundation is a fixed-size gradient `.plate` holding a recessed
 * `.panel` track. A single `.thumb` carries the selected look and slides
 * between the two sides via a composited `transform` transition, so the
 * animation runs on the compositor thread and is fully independent of the
 * rest of the page's render work. The active/idle labels crossfade in
 * step with the slide.
 *
 * The selection is tracked optimistically (`pending`) so the thumb starts
 * sliding the instant a side is clicked, rather than waiting for the
 * caller's `onChange` (e.g. a route swap) to push down a new `active`
 * prop.
 *
 * Memoized so it stays inert while its host re-renders for unrelated
 * reasons: it only re-renders when `options`, `active`, or `onChange`
 * actually change.
 */
function AppSwitchToggleBase({
  options,
  active,
  onChange,
  ariaLabel = "Switch",
}: AppSwitchToggleProps): React.ReactElement {
  const [pending, setPending] = useState<string | null>(null);
  const selected = pending ?? active;

  useEffect(() => {
    if (pending === active) setPending(null);
  }, [pending, active]);

  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.id === selected),
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.plate}>
        <div
          className={styles.panel}
          data-active-index={activeIndex}
          role="group"
          aria-label={ariaLabel}
        >
          <span className={styles.thumb} aria-hidden="true" />
          {options.map((option) => {
            const isActive = option.id === selected;
            return (
              <button
                key={option.id}
                type="button"
                className={cn(styles.half, isActive && styles.halfActive)}
                aria-pressed={isActive}
                onClick={() => {
                  if (isActive) return;
                  // Slide the thumb now; hand the selection to the caller
                  // right away. The slide is a composited transform, so it
                  // keeps animating smoothly even while the caller mounts
                  // whatever the new selection points at.
                  setPending(option.id);
                  onChange(option.id);
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

export const AppSwitchToggle = memo(AppSwitchToggleBase);
