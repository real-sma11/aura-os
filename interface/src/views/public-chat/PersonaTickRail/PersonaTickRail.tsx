import { useState, type ReactElement } from "react";
import styles from "./PersonaTickRail.module.css";

/**
 * Decorative vertical rail pinned to the far-right edge of the
 * public landing surface (`PublicChatView`). Renders six fixed-size
 * horizontal ticks stacked top-to-bottom — one per canonical agent
 * persona (Vibecoder, Indie Hacker, Giga Brain, Coordinator,
 * Researcher, Cypher Punk).
 *
 * Interaction model
 * -----------------
 * The rail tracks a single "active" persona at any time, defaulting
 * to the first entry. The active tick paints with
 * `var(--color-text-primary)` while every other tick paints with
 * `var(--color-text-secondary)`, so in dark mode the active mark
 * reads as white against the gray rest of the column, and in light
 * mode the colors invert automatically via the theme tokens.
 *
 * Hovering (or keyboard-focusing) any tick promotes that persona to
 * active AND unfurls a floating panel just to the left of the rail
 * that lists all six persona names — the active row in the panel is
 * highlighted to mirror the tick state. The tick marks themselves
 * never change size on hover; only their color shifts, matching the
 * spec.
 *
 * Clicks are intentionally captured (so a keyboard user pressing
 * `Enter` on a tick can persist the selection after their focus
 * moves) but otherwise carry no side effects — the rail is purely
 * decorative, and the parent `.tickRailSlot` declares
 * `pointer-events: none` with a single descendant override so the
 * rail never blocks clicks against the `MockAuraApp` wallpaper
 * behind it.
 */
const PERSONAS = [
  "Vibecoder",
  "Indie Hacker",
  "Giga Brain",
  "Coordinator",
  "Researcher",
  "Cypher Punk",
] as const;

export function PersonaTickRail(): ReactElement {
  const [activeIndex, setActiveIndex] = useState<number>(0);

  return (
    <div className={styles.rail} data-testid="persona-tick-rail">
      <ul className={styles.list} aria-label="Agent personas">
        {PERSONAS.map((name, index) => {
          const isActive = index === activeIndex;
          return (
            <li key={name} className={styles.row}>
              <button
                type="button"
                className={styles.tickButton}
                aria-label={name}
                aria-current={isActive ? "true" : undefined}
                data-active={isActive ? "true" : "false"}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => setActiveIndex(index)}
              >
                <span className={styles.tick} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className={styles.panel} role="presentation" aria-hidden="true">
        <ul className={styles.panelList}>
          {PERSONAS.map((name, index) => (
            <li
              key={name}
              className={styles.panelItem}
              data-active={index === activeIndex ? "true" : "false"}
            >
              {name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
