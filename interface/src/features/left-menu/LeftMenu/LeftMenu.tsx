import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import type { DesktopLeftMenuPaneDefinition } from "../types";
import { CascadeArmContext, NOOP_ARM } from "../cascade-arm";
import styles from "./LeftMenu.module.css";

interface LeftMenuProps {
  activeAppId: string;
  panes: DesktopLeftMenuPaneDefinition[];
  visitedAppIds: ReadonlySet<string>;
}

/**
 * How long the active pane carries `data-cascade="true"` after it becomes
 * active. Covers the shared row entrance (the `--aura-list-cascade-*` tokens in
 * index.css: 240ms duration + a capped 14 * 24ms stagger ~= 576ms) plus a small
 * buffer. Once cleared, rows that mount later (e.g. via scrolling) no longer
 * animate — only the reveal cascades.
 */
const CASCADE_WINDOW_MS = 650;

function shouldRenderPane(
  appId: string,
  activeAppId: string,
  visitedAppIds: ReadonlySet<string>,
): boolean {
  return appId === activeAppId || visitedAppIds.has(appId);
}

// Memoized so a change in `activeAppId` (the Agents <-> Projects flip) only
// updates the wrapping `<div>`'s visibility class — it never re-runs the pane
// body. `panes` is a module-level constant in the caller, so each `Pane`
// reference is referentially stable and this memo stays inert across the
// parent's switch-driven re-renders. Pane bodies still update via their own
// store/router subscriptions when their data actually changes.
const KeepAlivePane = memo(function KeepAlivePane({
  Pane,
}: {
  Pane: ComponentType;
}) {
  return <Pane />;
});

export function LeftMenu({
  activeAppId,
  panes,
  visitedAppIds,
}: LeftMenuProps) {
  // Drives the shared "cascade in" row entrance. While `cascading` is true the
  // active pane carries `data-cascade="true"`; its rows read that ancestor
  // attribute via CSS and stagger in. The flag clears after the cascade settles
  // so rows that mount later (scrolling) stay inert. Memoized panes never
  // re-render — only the wrapper attribute changes, and the row animation is
  // pure CSS.
  const [cascading, setCascading] = useState(true);
  // Bumped on every (re)arm so the clear-timer effect restarts.
  const [armNonce, setArmNonce] = useState(0);

  // Stable so the per-pane context value below only flips when `isActive`
  // changes (the switch), never on every render. Bumping the nonce both arms
  // the cascade and restarts its clear timer.
  const armCascade = useCallback<() => void>(() => {
    setCascading(true);
    setArmNonce((n) => n + 1);
  }, []);

  // Arm on initial mount + whenever the active pane changes. Done during render
  // (the sanctioned "derive state from props" pattern) so the revealed pane
  // commits with `data-cascade="true"` from its first frame — no post-paint
  // flash and no set-state-in-effect. Row data frequently loads asynchronously
  // *after* this though, so the active pane's list also re-arms via
  // `CascadeArmContext` once its rows first appear.
  const [armedAppId, setArmedAppId] = useState(activeAppId);
  if (armedAppId !== activeAppId) {
    setArmedAppId(activeAppId);
    armCascade();
  }

  // One-shot reveal: clear `data-cascade` after the window elapses. Only sets up
  // a timer here; the state flip happens in the async callback, so there is no
  // synchronous set-state-in-effect. Restarts on each arm via `armNonce`.
  useEffect(() => {
    if (!cascading) return;
    const timer = window.setTimeout(() => setCascading(false), CASCADE_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armNonce, cascading]);

  return (
    <div className={styles.root} data-testid="desktop-left-menu">
      {panes.map(({ appId, Pane }) => {
        if (!shouldRenderPane(appId, activeAppId, visitedAppIds)) {
          return null;
        }

        const isActive = appId === activeAppId;
        const className = [styles.pane, isActive ? "" : styles.paneHidden]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={appId}
            className={className}
            data-active={isActive || undefined}
            data-cascade={isActive && cascading ? "true" : undefined}
            data-testid={`desktop-left-menu-pane-${appId}`}
          >
            <CascadeArmContext.Provider value={isActive ? armCascade : NOOP_ARM}>
              <KeepAlivePane Pane={Pane} />
            </CascadeArmContext.Provider>
          </div>
        );
      })}
    </div>
  );
}
