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
   * content: public mode renders only the `ThemeToggleButton` in the
   * right slot, suppressing the left (Desktop + favorites) and
   * center (apps rail) columns. The outer `.bar` element is always
   * rendered so `--shell-chrome-outer-height` reserves the same row
   * of vertical space in every mode — flipping modes does not move
   * the main panel's bottom edge.
   */
  mode: UIMode;
}

/**
 * Bottom chrome strip rendered by `AuraShell` in every effective
 * mode. Phase 3 added the `mode` prop so the same DOM-identity outer
 * `.bar` element survives login / logout / Simple <-> Advanced flips
 * while its inner content swaps. The full taskbar (left favorites
 * strip, center app rail, right credits/settings/profile cluster)
 * mounts in `simple` and `advanced`; public renders a minimal
 * theme-toggle-only right slot. The full-mode branch holds the
 * existing auth-required hook calls and stays untouched so logged-in
 * users keep the same affordances.
 */
export function BottomTaskbar({ mode }: BottomTaskbarProps): React.ReactElement {
  if (mode === "public") {
    return <PublicBottomTaskbar />;
  }
  return <FullBottomTaskbar mode={mode} />;
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
          <ThemeToggleButton />
        </div>
      </div>
    </div>
  );
}

/**
 * Authenticated (Simple / Advanced) taskbar render path. Mirrors the
 * pre-Phase-3 component verbatim so logged-in users keep the same
 * Desktop / FavoriteAgentsStrip / AppNavRail / Apps / Credits /
 * Settings / Theme / Help / Profile / Clock arrangement.
 */
function FullBottomTaskbar({ mode }: { mode: UIMode }): React.ReactElement {
  const openBuyCredits = useUIModalStore((s) => s.openBuyCredits);
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const openAppsModal = useUIModalStore((s) => s.openAppsModal);
  const activeApp = useActiveApp();
  const time = useClock();
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
      </div>

      <div className={styles.center}>
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
      </div>

      <div className={styles.right}>
        <div className={styles.rightPrimary}>
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
          {!rightCollapsed && (
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
              <HelpButton />
            </>
          )}
          <AppNavRail
            layout="taskbar"
            includeIds={["profile"]}
            ariaLabel="Profile shortcut"
          />
        </div>
        <span className={styles.clock}>{time}</span>
      </div>
      {menuElement}
    </div>
  );
}
