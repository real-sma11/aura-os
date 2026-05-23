import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Circle,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  Settings,
} from "lucide-react";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useActiveApp } from "../../hooks/use-active-app";
import { useAppUIStore } from "../../stores/app-ui-store";
import type { UIMode } from "../../stores/ui-mode-store";
import {
  getTaskbarAppsCollapsed,
  getTaskbarRightCollapsed,
  setTaskbarAppsCollapsed,
  setTaskbarRightCollapsed,
} from "../../utils/storage";
import { AppNavRail, TaskbarIconButton, TASKBAR_ICON_SIZE } from "../AppNavRail";
import { useDesktopContextMenu } from "../DesktopContextMenu";
import { FavoriteAgentsStrip } from "./FavoriteAgentsStrip";
import { HelpButton } from "../../features/onboarding/HelpButton/HelpButton";
import { ThemeToggleButton } from "./ThemeToggleButton";
import { PoweredByGridButton } from "./PoweredByGridButton";
import styles from "./BottomTaskbar.module.css";

const TASKBAR_CHEVRON_SIZE = TASKBAR_ICON_SIZE + 1;

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export interface BottomTaskbarProps {
  /**
   * Effective UI mode (public / simple / advanced). Drives child
   * content. The outer `.bar` element is always rendered so
   * `--shell-chrome-outer-height` reserves the same row of vertical
   * space in every mode — flipping modes does not move the main
   * panel's bottom edge.
   *
   * - `public`: only the `ThemeToggleButton` in the right slot.
   * - `simple`: Credits, Settings, ThemeToggle, Profile rail in the
   *   right slot. No Desktop button, no app rail center, no clock,
   *   no Help, no collapse chevron — a minimal authed surface.
   * - `advanced`: full chrome (Desktop + favorites left, AppNavRail
   *   center, collapsible right cluster with Credits/Settings/
   *   ThemeToggle/Help/Profile, plus the clock readout).
   */
  mode: UIMode;
}

/**
 * Bottom chrome strip rendered by `AuraShell` in every effective
 * mode. The outer `.bar` element is mounted in all three modes (so
 * `--shell-chrome-outer-height` reserves the same row of vertical
 * space) while child slots branch on mode. `public` renders the
 * minimal theme-toggle path; authed (`simple` / `advanced`) renders
 * `AuthedBottomTaskbar`, which itself branches on `mode === "advanced"`
 * to swap the heavy chrome (Desktop button, app rail, collapse
 * chevron, Help, clock readout) on/off.
 */
export function BottomTaskbar({ mode }: BottomTaskbarProps): React.ReactElement {
  if (mode === "public") {
    return <PublicBottomTaskbar />;
  }
  return <AuthedBottomTaskbar mode={mode} />;
}

/**
 * Public-mode taskbar render path: outer `.bar` (preserves the
 * `--shell-chrome-outer-height` row in every mode) wrapping only a
 * theme toggle in the right cluster. Deliberately does NOT call any
 * auth-required hooks (`useUIModalStore`, `useActiveApp`,
 * `useAppUIStore`, `useDesktopContextMenu`, `useNavigate`-driven
 * navigation handlers, etc.) — those stores either don't apply or
 * would noisily report missing context for unauthenticated visitors.
 */
function PublicBottomTaskbar(): React.ReactElement {
  return (
    <div
      className={styles.bar}
      data-agent-surface="desktop-shell-bottom-taskbar"
      data-agent-proof="desktop-shell-bottom-taskbar"
      data-agent-context-anchor="desktop-shell-bottom-taskbar"
      data-ui-mode="public"
    >
      <div className={styles.right}>
        <div className={styles.rightPrimary}>
          <PoweredByGridButton />
          <ThemeToggleButton />
        </div>
      </div>
    </div>
  );
}

/**
 * Authenticated (Simple / Advanced) taskbar render path. The outer
 * `.bar` div, `.left` / `.center` / `.right` flex containers, and the
 * `rightPrimary` cluster are mounted unconditionally — so flipping
 * Simple <-> Advanced reconciles in place rather than remounting the
 * row. Branches on `isAdvanced` to gate:
 *
 *   - `.left`:  Desktop button + `<FavoriteAgentsStrip />` (Advanced only)
 *   - `.center`: AppNavRail + Apps + collapse chevron (Advanced only)
 *   - `.right.rightPrimary`:
 *     - Right-cluster collapse chevron (Advanced only)
 *     - Credits / Settings / ThemeToggle (both modes; in Advanced these
 *       hide behind the right-cluster collapse — Simple has no collapse
 *       affordance so they always show)
 *     - HelpButton (Advanced only)
 *     - Profile AppNavRail (both modes)
 *   - `.clock` readout (Advanced only — extracted into a tiny
 *     `<ClockReadout />` so `useClock`'s `setInterval` doesn't mount
 *     in Simple)
 *
 * The collapse-state hooks (`getTaskbarRightCollapsed` / `getTaskbarAppsCollapsed`)
 * still run unconditionally so the rules-of-hooks contract is preserved
 * across mode flips; Simple just ignores the stored value.
 */
function AuthedBottomTaskbar({
  mode,
}: {
  mode: Exclude<UIMode, "public">;
}): React.ReactElement {
  const isAdvanced = mode === "advanced";

  const openBuyCredits = useUIModalStore((s) => s.openBuyCredits);
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const openAppsModal = useUIModalStore((s) => s.openAppsModal);
  const activeApp = useActiveApp();
  const navigate = useNavigate();
  const previousPath = useAppUIStore((s) => s.previousPath);
  const [collapsed, setCollapsed] = useState(() => getTaskbarAppsCollapsed());
  const [rightCollapsed, setRightCollapsed] = useState(() => getTaskbarRightCollapsed());
  const { handleContextMenu, menuElement } = useDesktopContextMenu();

  const toggleAppsCollapsed = (): void => {
    setCollapsed((current) => {
      const next = !current;
      setTaskbarAppsCollapsed(next);
      return next;
    });
  };

  const toggleRightCollapsed = (): void => {
    setRightCollapsed((current) => {
      const next = !current;
      setTaskbarRightCollapsed(next);
      return next;
    });
  };

  // Only open the desktop context menu when the right-click lands on empty
  // taskbar chrome — clicks on icons/buttons keep their own behavior (or the
  // browser default for items without a custom handler).
  const onContextMenu = (event: React.MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, [role="menuitem"], [role="menu"]')) {
      return;
    }
    handleContextMenu(event);
  };

  // Simple has no collapse affordance — always show the secondary
  // cluster contents. Advanced respects the stored collapse state.
  const showSecondaryCluster = !isAdvanced || !rightCollapsed;

  return (
    <div
      className={styles.bar}
      data-agent-surface="desktop-shell-bottom-taskbar"
      data-agent-proof="desktop-shell-bottom-taskbar"
      data-agent-context-anchor="desktop-shell-bottom-taskbar"
      data-ui-mode={mode}
      onContextMenu={onContextMenu}
    >
      <div className={styles.left}>
        {isAdvanced && (
          <>
            <TaskbarIconButton
              selected={activeApp.id === "desktop"}
              icon={<Circle size={TASKBAR_ICON_SIZE} />}
              title="Desktop"
              aria-label="Desktop"
              onClick={() => {
                if (activeApp.id === "desktop") {
                  if (previousPath) navigate(previousPath);
                } else {
                  navigate("/desktop");
                }
              }}
            />
            <FavoriteAgentsStrip />
          </>
        )}
      </div>

      <div className={styles.center}>
        {isAdvanced && (
          <>
            <AppNavRail
              layout="taskbar"
              allowReorder
              excludeIds={["profile"]}
              {...(collapsed && { includeIds: ["agents", "projects"] })}
            />
            <TaskbarIconButton
              icon={<LayoutGrid size={TASKBAR_ICON_SIZE} />}
              title="Apps"
              aria-label="Apps"
              onClick={openAppsModal}
            />
            <TaskbarIconButton
              icon={
                collapsed ? (
                  <ChevronRight size={TASKBAR_CHEVRON_SIZE} />
                ) : (
                  <ChevronLeft size={TASKBAR_CHEVRON_SIZE} />
                )
              }
              onClick={toggleAppsCollapsed}
              aria-label={collapsed ? "Expand apps" : "Collapse apps"}
            />
          </>
        )}
      </div>

      <div className={styles.right}>
        <div className={styles.rightPrimary}>
          {isAdvanced && (
            <TaskbarIconButton
              icon={
                rightCollapsed ? (
                  <ChevronLeft size={TASKBAR_CHEVRON_SIZE} />
                ) : (
                  <ChevronRight size={TASKBAR_CHEVRON_SIZE} />
                )
              }
              onClick={toggleRightCollapsed}
              aria-label={rightCollapsed ? "Expand taskbar" : "Collapse taskbar"}
            />
          )}
          {showSecondaryCluster && (
            <>
              <TaskbarIconButton
                icon={<CreditCard size={TASKBAR_ICON_SIZE} />}
                title="Credits"
                aria-label="Credits"
                onClick={openBuyCredits}
              />
              <TaskbarIconButton
                icon={<Settings size={TASKBAR_ICON_SIZE} />}
                title="Settings"
                aria-label="Settings"
                onClick={openOrgSettings}
              />
              <ThemeToggleButton />
              {isAdvanced && <HelpButton />}
            </>
          )}
          <AppNavRail
            layout="taskbar"
            includeIds={["profile"]}
            ariaLabel="Profile shortcut"
          />
        </div>
        {isAdvanced && <ClockReadout />}
      </div>
      {menuElement}
    </div>
  );
}

/**
 * Live wall-clock readout extracted into a separate component so the
 * `setInterval` inside `useClock` only mounts in Advanced mode.
 * Simple mode never instantiates this component, so the timer never
 * fires — which both saves wakeups on simple-mode users and matches
 * the product spec ("no clock in Simple").
 */
function ClockReadout(): React.ReactElement {
  const time = useClock();
  return <span className={styles.clock}>{time}</span>;
}
