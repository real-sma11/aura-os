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
 * - `simple`: bottom-left `ProfilePill` (avatar + name) plus
 *   Credits, Settings, and ThemeToggle in the right slot.
 *   No Desktop button, no app rail center, no center pill, no
 *   profile rail shortcut, no clock, no Help, no collapse chevron
 *   — a minimal authed surface anchored by the profile pill.
 * - `advanced`: full chrome (ProfilePill + Desktop + favorites left,
 *   AppNavRail center, collapsible right cluster with Credits/
 *   Settings/ThemeToggle/Help/Profile, plus the clock readout).
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
      <div className={styles.left}>
        <ThemeToggleButton />
      </div>
      <div className={styles.right}>
        <div className={styles.rightPrimary}>
          <PoweredByGridButton />
        </div>
      </div>
    </div>
  );
}

/**
 * Authenticated (Simple / Advanced) taskbar render path. The outer
 * `.bar` div, the `.left` pill (anchored by `<ProfilePill />`), the
 * `.right` flex container, and the `rightPrimary` cluster are mounted
 * unconditionally — so flipping Simple <-> Advanced reconciles the
 * load-bearing chrome in place (the outer `.bar` reserves
 * `--shell-chrome-outer-height`). The `.center` pill container is
 * still gated on `isAdvanced`.
 *
 * This component acts as the container for the presentational
 * `<ProfilePill />`: it reads `profile-store` (display name, avatar)
 * and `ui-modal-store` (`openOrgSettings`) and pipes them in as props.
 *
 * Branches on `isAdvanced` to gate:
 *
 *   - `.left`:  the pill is mounted in both modes; the trailing
 *     Desktop `TaskbarIconButton` and `<FavoriteAgentsStrip />` are
 *     Advanced-only. Simple shows the profile pill on its own.
 *   - `.center`: the entire pill (AppNavRail + Apps + collapse
 *     chevron) — Advanced only.
 *   - `.right.rightPrimary`:
 *     - Right-cluster collapse chevron (Advanced only)
 *     - Credits / Settings / ThemeToggle (both modes; in Advanced these
 *       hide behind the right-cluster collapse — Simple has no collapse
 *       affordance so they always show)
 *     - HelpButton (Advanced only)
 *     - Profile AppNavRail (Advanced only — Simple drops the profile
 *       shortcut so the right cluster reads as Credits / Settings /
 *       Theme only)
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
        <ProfilePill
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          onOpenSettings={openOrgSettings}
          plan={plan}
        />
        {/*
         * Team selector lives in the bottom taskbar (left of the
         * Desktop icon in Advanced; right after `ProfilePill` in
         * Simple, which has no Desktop icon). The titlebar's leading
         * slot is now a uniform `<PanelLeft />` drawer toggle across
         * every mode, so the team affordance no longer competes for
         * that spot.
         */}
        <OrgSelector variant="icon" />
        {isAdvanced && (
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
        )}
        {isAdvanced && <FavoriteAgentsStrip />}
      </div>

      {isAdvanced && (
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
      )}

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
          {isAdvanced && (
            <AppNavRail
              layout="taskbar"
              includeIds={["profile"]}
              ariaLabel="Profile shortcut"
            />
          )}
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
