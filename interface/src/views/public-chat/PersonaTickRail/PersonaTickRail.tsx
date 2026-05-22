import type { ReactElement } from "react";
import { PERSONAS } from "../personas";
import styles from "./PersonaTickRail.module.css";

/**
 * Decorative vertical rail pinned to the far-right edge of the
 * public landing surface (`PublicChatView`). Renders one fixed-size
 * horizontal tick per entry in `PERSONAS`, top-to-bottom, plus a
 * floating panel that lists every persona name and unfurls on
 * hover/focus of the rail.
 *
 * Controlled component
 * --------------------
 * The active index is owned by the parent (`PublicChatView`) so the
 * same selection can drive both the rail visuals and the page-level
 * theme (`MockAuraApp` wallpaper + `.chatView` site background).
 * The rail only renders state — every interaction (`onMouseEnter`,
 * `onFocus`, `onClick`) calls `onActiveIndexChange` with the index
 * the user is pointing at, and the parent decides whether to keep
 * or override the change.
 *
 * Visual model
 * ------------
 * Ticks stay a fixed 18x2 px (14 px on mobile) and only swap the
 * `background` token between `--color-text-secondary` (idle) and
 * `--color-text-primary` (active). In dark mode the active mark
 * reads white against gray; in light mode the colors invert via
 * `tokens.css`. The panel uses `--color-bg-elevated` /
 * `--color-border-strong` so it stays legible against any active
 * theme background painted by the parent.
 *
 * Pointer-events
 * --------------
 * The parent `.tickRailSlot` declares `pointer-events: none` with
 * a single descendant override (see `PublicChatView.module.css`),
 * so the rail never blocks clicks against the `MockAuraApp`
 * wallpaper sitting behind it even though the tick buttons
 * themselves are interactive.
 */
export interface PersonaTickRailProps {
  /** Index into `PERSONAS` that should paint as active. */
  readonly activeIndex: number;
  /**
   * Called every time the visitor points at a tick — via mouse
   * enter, keyboard focus, or click. The parent is free to
   * persist the change, snap back to a default, or ignore it.
   */
  readonly onActiveIndexChange: (index: number) => void;
}

export function PersonaTickRail({
  activeIndex,
  onActiveIndexChange,
}: PersonaTickRailProps): ReactElement {
  return (
    <div className={styles.rail} data-testid="persona-tick-rail">
      <ul className={styles.list} aria-label="Agent personas">
        {PERSONAS.map((persona, index) => {
          const isActive = index === activeIndex;
          return (
            <li key={persona.id} className={styles.row}>
              <button
                type="button"
                className={styles.tickButton}
                aria-label={persona.name}
                aria-current={isActive ? "true" : undefined}
                data-active={isActive ? "true" : "false"}
                data-persona-id={persona.id}
                onMouseEnter={() => onActiveIndexChange(index)}
                onFocus={() => onActiveIndexChange(index)}
                onClick={() => onActiveIndexChange(index)}
              >
                <span className={styles.tick} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className={styles.panel} role="presentation" aria-hidden="true">
        <ul className={styles.panelList}>
          {PERSONAS.map((persona, index) => (
            <li
              key={persona.id}
              className={styles.panelItem}
              data-active={index === activeIndex ? "true" : "false"}
            >
              {persona.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
