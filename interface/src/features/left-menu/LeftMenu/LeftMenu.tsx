import { memo, type ComponentType } from "react";
import type { DesktopLeftMenuPaneDefinition } from "../types";
import styles from "./LeftMenu.module.css";

interface LeftMenuProps {
  activeAppId: string;
  panes: DesktopLeftMenuPaneDefinition[];
  visitedAppIds: ReadonlySet<string>;
}

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
  return (
    <div className={styles.root} data-testid="desktop-left-menu">
      {panes.map(({ appId, Pane }) => {
        if (!shouldRenderPane(appId, activeAppId, visitedAppIds)) {
          return null;
        }

        const className = [
          styles.pane,
          appId === activeAppId ? "" : styles.paneHidden,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={appId}
            className={className}
            data-active={appId === activeAppId || undefined}
            data-testid={`desktop-left-menu-pane-${appId}`}
          >
            <KeepAlivePane Pane={Pane} />
          </div>
        );
      })}
    </div>
  );
}
