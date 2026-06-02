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
import { useProfileStore } from "../../stores/profile-store";
import { useBillingStore } from "../../stores/billing-store";
import { useActiveApp } from "../../hooks/use-active-app";
import { useAppUIStore } from "../../stores/app-ui-store";
import type { UIMode } from "../../stores/ui-mode-store";
import type { ProfilePlan } from "./ProfilePill";
import {
  getTaskbarAppsCollapsed,
  getTaskbarRightCollapsed,
  setTaskbarAppsCollapsed,
  setTaskbarRightCollapsed,
} from "../../utils/storage";
import { AppNavRail, TaskbarIconButton, TASKBAR_ICON_SIZE } from "../AppNavRail";
import { useDesktopContextMenu } from "../DesktopContextMenu";
import { OrgSelector } from "../OrgSelector";
import { FavoriteAgentsStrip } from "./FavoriteAgentsStrip";
import { ProfilePill } from "./ProfilePill";
import { HelpButton } from "../../features/onboarding/HelpButton/HelpButton";
import { ThemeToggleButton } from "./ThemeToggleButton";
import { PublicChatTaskbarButton } from "./PublicChatTaskbarButton";
import { PoweredByGridButton } from "./PoweredByGridButton";
import { RotatingTagline } from "./RotatingTagline";
import { SidebarDrawerToggle } from "../AuraShell/SidebarDrawerToggle";
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
   * Effective UI mode (public / standard). Drives child content. The
   * outer `.bar` element is always rendered so
   * `--shell-chrome-outer-height` reserves the same row of vertical
   * space in every mode — flipping modes does not move the main
   * panel's bottom edge.
   *
   * - `public`: only the `ThemeToggleButton` in the right slot.
   * - `standard`: full chrome (ProfilePill + favorites left,
   *   Desktop + AppNavRail center, collapsible right cluster with
   *   Credits/ThemeToggle/Help/Profile, plus an always-visible Settings
   *   button directly to the left of the clock readout).
   */
  mode: UIMode;
}

/**
 * Bottom chrome strip rendered by `AuraShell` in every effective
 * mode. The outer `.bar` element is mounted in both modes (so
 * `--shell-chrome-outer-height` reserves the same row of vertical
 * space) while child slots branch on mode. `public` renders the
 * minimal theme-toggle path; the authed `standard` mode renders
 * `AuthedBottomTaskbar` with the full chrome (Desktop button, app
 * rail, collapse chevron, Help, clock readout).
 */
export function BottomTaskbar({ mode }: BottomTaskbarProps): React.ReactElement {
  if (mode === "public") {
    return <PublicBottomTaskbar />;
  }
  return <AuthedBottomTaskbar mode={mode} />;
}

/**
 * Public-mode taskbar render path: outer `.bar` (preserves the
 * `--shell-chrome-outer-height` row in every mode) wrapping two
 * independent floating-pill clusters split to opposite edges by the
 * bar's `justify-content: space-between`. The left cluster
 * (`.publicLeft`) carries the Chat link (`.chatPill`, far left), the
 * theme toggle (`.themePill`) and the rotating tagline bubble
 * (`.taglineBubble`); the right cluster (`.publicRight`) carries the
 * "Powered by THE GRID" chip (`.poweredPill`). Deliberately does NOT
 * call any
 * auth-required hooks (`useUIModalStore`, `useActiveApp`,
 * `useAppUIStore`, `useDesktopContextMenu`, `useNavigate`-driven
 * navigation handlers, etc.) — those stores either don't apply or
 * would noisily report missing context for unauthenticated visitors.
 */
function PublicBottomTaskbar(): React.ReactElement {
  const publicSidebarCollapsed = useAppUIStore((s) => s.publicSidebarCollapsed);
  const togglePublicSidebar = useAppUIStore((s) => s.togglePublicSidebar);
  return (
    <div
      className={styles.bar}
      data-agent-surface="desktop-shell-bottom-taskbar"
      data-agent-proof="desktop-shell-bottom-taskbar"
      data-agent-context-anchor="desktop-shell-bottom-taskbar"
      data-ui-mode="public"
    >
      <div className={styles.publicLeft}>
        <div className={styles.togglePill}>
          <SidebarDrawerToggle
            collapsed={publicSidebarCollapsed}
            onToggle={togglePublicSidebar}
          />
        </div>
        <div className={styles.chatPill}>
          <PublicChatTaskbarButton />
        </div>
        <div className={styles.themePill}>
          <ThemeToggleButton />
        </div>
      </div>
      <div className={styles.publicCenter}>
        <div className={styles.taglineBubble}>
          <RotatingTagline />
        </div>
      </div>
      <div className={styles.publicRight}>
        <div className={styles.poweredPill}>
          <PoweredByGridButton />
        </div>
      </div>
    </div>
  );
}

/**
 * Authenticated (standard) taskbar render path. The outer `.bar` div,
 * the `.left` pill (anchored by `<ProfilePill />`), the `.center`
 * cluster, the `.right` flex container, and the `rightPrimary` cluster
 * are all mounted (the outer `.bar` reserves
 * `--shell-chrome-outer-height`).
 *
 * This component acts as the container for the presentational
 * `<ProfilePill />`: it reads `profile-store` (display name, avatar)
 * and `ui-modal-store` (`openOrgSettings`) and pipes them in as props.
 *
 * Layout:
 *
 *   - `.left`:  `<ProfilePill />` + `<OrgSelector />` +
 *     `<FavoriteAgentsStrip />`.
 *   - `.center`: Desktop circle (leads the cluster) + AppNavRail +
 *     Apps + apps collapse chevron.
 *   - `.right.rightPrimary`: right-cluster collapse chevron, then the
 *     collapsible secondary cluster (Credits / ThemeToggle / Help /
 *     Profile shortcut), then an always-visible Settings button
 *     trailing the cluster (directly to the left of `<ClockReadout />`)
 *     regardless of `rightCollapsed`.
 *   - `.clock` readout (`<ClockReadout />`).
 */
function AuthedBottomTaskbar({
  mode,
}: {
  mode: "standard";
}): React.ReactElement {
  const openBuyCredits = useUIModalStore((s) => s.openBuyCredits);
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const openAppsModal = useUIModalStore((s) => s.openAppsModal);
  const profile = useProfileStore((s) => s.profile);
  // Subscription is owned by `billing-store` and prefetched lazily when the
  // user opens the org-settings panel; we trigger an extra fetch on mount
  // here so the trailing `<PlanBadge />` next to the user name hydrates
  // for paid subscribers without requiring them to open Settings first.
  const subscription = useBillingStore((s) => s.subscription);
  const fetchSubscription = useBillingStore((s) => s.fetchSubscription);
  useEffect(() => {
    if (!subscription) void fetchSubscription();
  }, [subscription, fetchSubscription]);
  const plan = subscription?.plan as ProfilePlan | undefined;
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

  const showSecondaryCluster = !rightCollapsed;

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
        <ProfilePill
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          onOpenSettings={openOrgSettings}
          plan={plan}
        />
        {/*
         * Team selector lives in the bottom taskbar right after
         * `ProfilePill`. The Desktop icon now leads the `.center`
         * cluster instead of trailing the left cluster, so
         * `OrgSelector` is the last fixed item in `.left` (followed
         * only by `FavoriteAgentsStrip`). The titlebar's leading slot
         * is a uniform `<PanelLeft />` drawer toggle, so the team
         * affordance no longer competes for that spot.
         */}
        <OrgSelector variant="icon" />
        <FavoriteAgentsStrip />
      </div>

      <div className={styles.center}>
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
          {showSecondaryCluster && (
            <>
              <TaskbarIconButton
                icon={<CreditCard size={TASKBAR_ICON_SIZE} />}
                title="Credits"
                aria-label="Credits"
                onClick={openBuyCredits}
              />
              <ThemeToggleButton />
              <HelpButton />
              <AppNavRail
                layout="taskbar"
                includeIds={["profile"]}
                ariaLabel="Profile shortcut"
              />
            </>
          )}
          {/*
           * Settings is rendered unconditionally as the trailing item
           * of `.rightPrimary`, which places it directly to the left of
           * `<ClockReadout />`. It is intentionally outside the
           * `showSecondaryCluster` branch so the right-cluster collapse
           * no longer hides it — Settings is always one click away
           * regardless of `rightCollapsed`.
           */}
          <TaskbarIconButton
            icon={<Settings size={TASKBAR_ICON_SIZE} />}
            title="Settings"
            aria-label="Settings"
            onClick={openOrgSettings}
          />
        </div>
        <ClockReadout />
      </div>
      {menuElement}
    </div>
  );
}

/**
 * Live wall-clock readout extracted into a separate component so the
 * `setInterval` inside `useClock` only mounts in the authed standard
 * shell. Public mode never instantiates this component, so the timer
 * never fires.
 */
function ClockReadout(): React.ReactElement {
  const time = useClock();
  return <span className={styles.clock}>{time}</span>;
}
