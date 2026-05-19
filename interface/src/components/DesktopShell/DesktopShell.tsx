import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  lazy,
  useRef,
  useState,
} from "react";
import { useOutlet } from "react-router-dom";
import { cn } from "@cypher-asi/zui";
import { Lane, type LaneResizeControls } from "../Lane";
import { ResponsiveMainLane } from "../ResponsiveMainLane";
import { BottomTaskbar } from "../BottomTaskbar";
import { ErrorBoundary } from "../ErrorBoundary";
import { useActiveApp } from "../../hooks/use-active-app";
import { apps } from "../../apps/registry";

import { useAppUIStore } from "../../stores/app-ui-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import { useShallow } from "zustand/react/shallow";
import { LeftMenu } from "../../features/left-menu";
import {
  DEFAULT_SIDEKICK_WIDTH,
  persistSidekickWidth,
  readStoredSidekickWidth,
  SIDEKICK_MIN_WIDTH,
} from "./desktop-shell-sidekick";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { BackgroundLayer } from "./BackgroundLayer";
import { DesktopTitlebar } from "./DesktopTitlebar";
import { PersistentSidekickLane } from "./PersistentSidekickLane";
import { SidebarSearchInput } from "./SidebarSearchInput";
import { SidekickPortalBridge } from "./SidekickPortalBridge";
import { useLeftPanelWidthCssVar } from "./desktop-shell-effects";
import styles from "./DesktopShell.module.css";

const DesktopWindowLayer = lazy(() =>
  import("../../apps/agents/components/AgentWindow").then((module) => ({ default: module.DesktopWindowLayer })),
);
const HostSettingsModal = lazy(() =>
  import("../HostSettingsModal").then((module) => ({ default: module.HostSettingsModal })),
);

const sharedDesktopLeftMenuPanes = apps.flatMap((app) => {
  const Pane = app.DesktopLeftMenuPane;
  return Pane ? [{ appId: app.id, Pane }] : [];
});

function usesSharedDesktopLeftMenu(appId: string): boolean {
  return sharedDesktopLeftMenuPanes.some((pane) => pane.appId === appId);
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

export function DesktopShell() {
  const activeApp = useActiveApp();
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);
  const sidekickCollapsed = useAppUIStore((s) => s.sidekickCollapsed);
  const toggleSidekick = useAppUIStore((s) => s.toggleSidekick);
  const sidekickSplitScreen = useAppUIStore((s) => s.sidekickSplitScreen);
  const setSidekickSplitScreen = useAppUIStore((s) => s.setSidekickSplitScreen);
  const { hostSettingsOpen, openHostSettings, closeHostSettings } = useUIModalStore(
    useShallow((s) => ({
      hostSettingsOpen: s.hostSettingsOpen,
      openHostSettings: s.openHostSettings,
      closeHostSettings: s.closeHostSettings,
    })),
  );
  const routeContent = useOutlet();
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const desktopContentRef = useRef<HTMLDivElement>(null);
  const mainPanelHostRef = useRef<HTMLDivElement>(null);
  const sidekickLaneRef = useRef<HTMLDivElement>(null);
  const sidekickResizeControlsRef = useRef<LaneResizeControls | null>(null);
  // Avoid treating the programmatic setSize that drives the split-screen
  // animation as a manual user drag (which would immediately exit split mode).
  const programmaticResizeRef = useRef(false);
  // The sidekick lane uses a single shared width across every app. We read it
  // once at mount and pass it as `defaultWidth` to the persistent `Lane`; the
  // lane is never re-targeted on app switches so its size stays stable.
  const [sidekickInitialWidth] = useState(() => readStoredSidekickWidth());
  const [sidekickHeaderTarget, setSidekickHeaderTarget] =
    useState<HTMLDivElement | null>(null);
  const [sidekickPanelTarget, setSidekickPanelTarget] =
    useState<HTMLDivElement | null>(null);
  const openDesktopWindowCount = useDesktopWindowStore((state) => Object.keys(state.windows).length);
  const backgroundHydrated = useDesktopBackgroundStore((s) => s.hydrated);
  const { MainPanel } = activeApp;
  const ActiveProvider = activeApp.Provider ?? Fragment;
  const isDesktop = activeApp.id === "desktop";
  const desktopModeActive = isDesktop && backgroundHydrated;
  const hasActiveSidekick = Boolean(activeApp.SidekickPanel) && !isDesktop;
  const sidekickHostCollapsed = sidekickCollapsed || !hasActiveSidekick;
  const showSidekickHeader = hasActiveSidekick && Boolean(activeApp.SidekickTaskbar);
  const splitScreenActive = sidekickSplitScreen && hasActiveSidekick;

  const handleSidekickHeaderTargetChange = useCallback(
    (node: HTMLDivElement | null) => {
      setSidekickHeaderTarget((currentNode) =>
        currentNode === node ? currentNode : node,
      );
    },
    [],
  );

  const handleSidekickPanelTargetChange = useCallback(
    (node: HTMLDivElement | null) => {
      setSidekickPanelTarget((currentNode) =>
        currentNode === node ? currentNode : node,
      );
    },
    [],
  );

  const handleSidekickResizeEnd = useCallback((size: number) => {
    if (programmaticResizeRef.current) return;
    persistSidekickWidth(size);
  }, []);

  // When the user drags the sidekick handle while split-screen mode is on,
  // treat the drag as an explicit width override and exit split mode. The
  // final width still persists through `onResizeEnd` above.
  const handleSidekickResize = useCallback(() => {
    if (programmaticResizeRef.current) return;
    setSidekickSplitScreen(false);
  }, [setSidekickSplitScreen]);

  const computeSplitTargetWidth = useCallback((): number | null => {
    const mainEl = mainPanelHostRef.current;
    const sidekickEl = sidekickLaneRef.current;
    if (!mainEl || !sidekickEl) return null;
    // ZUI's base reset applies `box-sizing: border-box` globally, so the
    // lane's CSS width equals its rendered `offsetWidth`. The budget for
    // main + sidekick is just the sum of their current outer widths — this
    // also handles the collapsed-sidekick case correctly (`sidekickOuter`
    // is 0 and the main panel already owns the whole budget).
    const mainOuter = mainEl.offsetWidth;
    const sidekickOuter = sidekickEl.offsetWidth;
    const budget = mainOuter + sidekickOuter;
    if (budget <= 0) return null;
    const half = Math.floor(budget / 2);
    const maxAllowed = Math.max(SIDEKICK_MIN_WIDTH, budget - SIDEKICK_MIN_WIDTH);
    return Math.min(Math.max(SIDEKICK_MIN_WIDTH, half), maxAllowed);
  }, []);

  const applySplitTargetWidth = useCallback(() => {
    const controls = sidekickResizeControlsRef.current;
    if (!controls) return;
    const target = computeSplitTargetWidth();
    if (target == null) return;
    programmaticResizeRef.current = true;
    controls.setSize(target);
    // Release the guard on the next frame so any synchronous onResize callbacks
    // from setSize have already been processed.
    requestAnimationFrame(() => {
      programmaticResizeRef.current = false;
    });
  }, [computeSplitTargetWidth]);

  const handleToggleSplitScreen = useCallback(() => {
    if (!hasActiveSidekick) return;
    if (splitScreenActive) {
      // Per UX: toggling off always returns to the default sidekick width,
      // not whatever the user had drag-resized to previously. Persist the
      // default so the lane's stored state stays consistent.
      programmaticResizeRef.current = true;
      sidekickResizeControlsRef.current?.setSize(DEFAULT_SIDEKICK_WIDTH);
      persistSidekickWidth(DEFAULT_SIDEKICK_WIDTH);
      requestAnimationFrame(() => {
        programmaticResizeRef.current = false;
      });
      setSidekickSplitScreen(false);
      return;
    }
    if (sidekickCollapsed) {
      toggleSidekick();
    }
    setSidekickSplitScreen(true);
    applySplitTargetWidth();
  }, [
    applySplitTargetWidth,
    hasActiveSidekick,
    setSidekickSplitScreen,
    sidekickCollapsed,
    splitScreenActive,
    toggleSidekick,
  ]);

  // Keep the sidekick at 50/50 while split mode is active and the
  // surrounding container resizes (window resize, sidebar resize, etc.).
  useEffect(() => {
    if (!splitScreenActive) return;
    const contentEl = desktopContentRef.current;
    if (!contentEl) return;
    applySplitTargetWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      applySplitTargetWidth();
    });
    observer.observe(contentEl);
    return () => {
      observer.disconnect();
    };
  }, [applySplitTargetWidth, splitScreenActive]);

  // If the active app loses its sidekick while split mode is on, exit cleanly
  // so the next app that has one starts in standard width.
  useEffect(() => {
    if (sidekickSplitScreen && !hasActiveSidekick) {
      setSidekickSplitScreen(false);
    }
  }, [hasActiveSidekick, setSidekickSplitScreen, sidekickSplitScreen]);

  useLeftPanelWidthCssVar({
    leftPanelRef,
    isDesktop,
    activeAppId: activeApp.id,
  });

  return (
    <>
      <div
        className={styles.desktopShell}
        data-desktop-mode={desktopModeActive || undefined}
        data-agent-context="desktop-shell"
      >
        <BackgroundLayer />
        <DesktopTitlebar
          sidekickCollapsed={sidekickCollapsed}
          onToggleSidekick={toggleSidekick}
          splitScreenActive={splitScreenActive}
          onToggleSplitScreen={hasActiveSidekick ? handleToggleSplitScreen : undefined}
          onOpenHostSettings={openHostSettings}
        />

        <div ref={desktopContentRef} className={styles.desktopContent}>
          <div ref={leftPanelRef} className={styles.desktopSidebar}>
            <div className={styles.desktopSidebarBody}>
              <Lane
                resizable
                resizePosition="right"
                defaultWidth={200}
                maxWidth={600}
                storageKey="aura-sidebar"
                collapsible
                collapsed={isDesktop}
                animateCollapse={false}
                header={<SidebarSearchInput />}
              >
                {usesSharedDesktopLeftMenu(activeApp.id) ? (
                  <LeftMenu
                    activeAppId={activeApp.id}
                    panes={sharedDesktopLeftMenuPanes}
                    visitedAppIds={visitedAppIds}
                  />
                ) : (
                  <div
                    className={styles.panelActive}
                    data-agent-surface="left-panel"
                    data-agent-active-app-id={activeApp.id}
                    data-agent-active-app-label={activeApp.label}
                    aria-label={`${activeApp.label} navigation panel`}
                  >
                    <activeApp.LeftPanel />
                  </div>
                )}
              </Lane>
            </div>
          </div>

          <div
            ref={mainPanelHostRef}
            className={cn(
              styles.mainPanelHost,
              sidekickHostCollapsed && styles.mainPanelHostNoSidekick,
            )}
            data-agent-surface="main-panel"
            data-agent-active-app-id={activeApp.id}
            data-agent-active-app-label={activeApp.label}
            aria-label={`${activeApp.label} main panel`}
          >
            {activeApp.bareMainPanel ? (
              <ActiveProvider>
                <ErrorBoundary name="main">
                  <MainPanel>{routeContent}</MainPanel>
                </ErrorBoundary>
              </ActiveProvider>
            ) : (
              <ResponsiveMainLane>
                <ActiveProvider>
                  <ErrorBoundary name="main">
                    <MainPanel>{routeContent}</MainPanel>
                  </ErrorBoundary>
                </ActiveProvider>
              </ResponsiveMainLane>
            )}
          </div>
          {hasActiveSidekick && (
            <ErrorBoundary name="sidekick">
              <SidekickPortalBridge
                headerTarget={sidekickHeaderTarget}
                panelTarget={sidekickPanelTarget}
              />
            </ErrorBoundary>
          )}
          <PersistentSidekickLane
            collapsed={sidekickHostCollapsed}
            defaultWidth={sidekickInitialWidth}
            showHeaderSlot={showSidekickHeader}
            maxWidth={splitScreenActive ? Number.POSITIVE_INFINITY : undefined}
            laneRef={sidekickLaneRef}
            resizeControlsRef={sidekickResizeControlsRef}
            onResize={handleSidekickResize}
            onResizeEnd={handleSidekickResizeEnd}
            onHeaderTargetChange={handleSidekickHeaderTargetChange}
            onPanelTargetChange={handleSidekickPanelTargetChange}
          />
          {openDesktopWindowCount > 0 ? (
            <ErrorBoundary name="windows">
              <div className={styles.windowLayerHost} data-window-layer-host="true">
                <Suspense fallback={null}>
                  <DesktopWindowLayer />
                </Suspense>
              </div>
            </ErrorBoundary>
          ) : null}
        </div>
        <BottomTaskbar />
      </div>

      {hostSettingsOpen ? (
        <Suspense fallback={null}>
          <HostSettingsModal
            isOpen={hostSettingsOpen}
            onClose={() => {
              blurActiveElement();
              closeHostSettings();
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
