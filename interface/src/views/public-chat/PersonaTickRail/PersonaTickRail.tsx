import { useEffect, useRef, useState, type ReactElement } from "react";
import { PERSONAS } from "../personas";
import styles from "./PersonaTickRail.module.css";

/**
 * Decorative rail pinned to the far-right edge of the public
 * landing surface (`PublicChatView`). In its resting state the
 * rail shows one fixed-size horizontal tick per entry in
 * `PERSONAS`, stacked top-to-bottom with the active persona
 * painted in `--color-text-primary` and the rest in
 * `--color-text-secondary` so the column reads as a calm
 * scrollbar-style indicator that's already theme-aware.
 *
 * Open / close model
 * ------------------
 * Hovering (or keyboard-focusing) anywhere on the rail flips it
 * into the "open" state — the tick column fades to transparent
 * and a floating panel slides in from the right to *cover* the
 * exact slot the ticks occupied, listing all six personas as
 * clickable rows. Selecting a panel row:
 *
 *   1. notifies the parent via `onActiveIndexChange` so the new
 *      persona's theme takes over immediately, and
 *   2. closes the panel so the visitor is dropped back to the
 *      minimal tick column with their new selection painted as
 *      active.
 *
 * Mouse-out also closes, but on an 80ms debounce so the panel
 * survives the brief gap when the cursor crosses from the tick
 * area onto the panel itself (the panel sits inside the same
 * `.rail` wrapper, but the panel extends visually further left,
 * so a hard mouseleave/enter pair would otherwise flicker the
 * panel closed and immediately re-open it).
 *
 * Controlled component
 * --------------------
 * The active index is owned by the parent (`PublicChatView`) so
 * the same selection drives both the rail visuals and the
 * page-level theme. The open/close state is local to the rail —
 * no parent needs to know whether the menu is visible.
 */
const CLOSE_DEBOUNCE_MS = 80;

export interface PersonaTickRailProps {
  /** Index into `PERSONAS` that should paint as active. */
  readonly activeIndex: number;
  /**
   * Called when the visitor commits a persona by clicking a
   * panel row (or pressing Enter on a focused tick). The parent
   * is free to persist the change, snap back to a default, or
   * ignore it.
   */
  readonly onActiveIndexChange: (index: number) => void;
}

export function PersonaTickRail({
  activeIndex,
  onActiveIndexChange,
}: PersonaTickRailProps): ReactElement {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduledClose = (): void => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const open = (): void => {
    cancelScheduledClose();
    setIsOpen(true);
  };

  const scheduleClose = (): void => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DEBOUNCE_MS);
  };

  const commitSelection = (index: number): void => {
    cancelScheduledClose();
    onActiveIndexChange(index);
    setIsOpen(false);
  };

  useEffect(() => cancelScheduledClose, []);

  return (
    <div
      className={styles.rail}
      data-testid="persona-tick-rail"
      data-panel-open={isOpen ? "true" : "false"}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
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
                onFocus={open}
                onBlur={scheduleClose}
                onClick={() => commitSelection(index)}
              >
                <span className={styles.tick} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <div
        className={styles.panel}
        data-testid="persona-tick-rail-panel"
        aria-hidden={isOpen ? undefined : "true"}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
      >
        <ul className={styles.panelList}>
          {PERSONAS.map((persona, index) => (
            <li key={persona.id} className={styles.panelRow}>
              <button
                type="button"
                className={styles.panelItem}
                data-active={index === activeIndex ? "true" : "false"}
                data-persona-id={persona.id}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => commitSelection(index)}
              >
                {persona.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
