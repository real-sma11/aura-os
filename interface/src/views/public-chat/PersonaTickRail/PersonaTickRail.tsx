import type { ReactElement } from "react";
import styles from "./PersonaTickRail.module.css";

/**
 * Decorative vertical rail pinned to the far-right edge of the
 * public landing surface (`PublicChatView`). Renders six small
 * horizontal ticks stacked top-to-bottom, each tagged with the
 * name of one of the canonical agent personas Aura is positioned
 * for. Hovering or keyboard-focusing a tick reveals the persona
 * label as a small pill that slides in from the right of the tick.
 *
 * The rail itself doesn't drive any state — there is no demo
 * scenario switching, no routing, no analytics dispatch. Each tick
 * is a real `<button>` only so screen readers and keyboard users
 * can still surface the persona names via the `aria-label`; the
 * buttons intentionally omit an `onClick` and the rail's parent
 * `.tickRailSlot` declares `pointer-events: none` with a single
 * descendant override so the rail never blocks clicks against the
 * `MockAuraApp` wallpaper that sits behind it.
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
  return (
    <ul
      className={styles.rail}
      aria-label="Agent personas"
      data-testid="persona-tick-rail"
    >
      {PERSONAS.map((name) => (
        <li key={name} className={styles.row}>
          <button
            type="button"
            className={styles.tickButton}
            aria-label={name}
          >
            <span className={styles.label} aria-hidden="true">
              {name}
            </span>
            <span className={styles.tick} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
