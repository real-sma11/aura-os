import { useEffect, useMemo, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { MenuItem } from "@cypher-asi/zui";
import {
  Archive,
  Info,
  File,
  Check,
  ScrollText,
  BarChart3,
  MessageSquare,
  FolderClosed,
  Play,
  Plus,
  SquareTerminal,
  Globe,
} from "lucide-react";
import { useSidekickStore, type SidekickTab } from "../../stores/sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useBrowserPanelStore } from "../../stores/browser-panel-store";
import { SidekickTabBar, type TabItem } from "../SidekickTabBar";
import { LoopProgress } from "../LoopProgress";
import {
  selectAgentInstanceActivity,
  selectProjectActivity,
  useLoopActivityStore,
} from "../../stores/loop-activity-store";
import { isLoopActivityActive } from "../../shared/types/aura-events";
import styles from "../Sidekick/Sidekick.module.css";

/**
 * Tab icon with an optional rotating progress ring overlay.
 *
 * Used by the `Run` tab so the Play affordance stays recognisable
 * while the loop is active. The earlier "swap Play out for a bare
 * spinner" approach produced a 16px circle that reads as "some
 * indicator" rather than "the Run button, currently running", and
 * users repeatedly reported they couldn't see the Run/Play icon
 * after starting the loop. Mirroring the AutomationBar's
 * `PlayWithProgressRing` shape (icon stays, ring overlays) fixes
 * the regression and keeps loop activity legible at tab-strip
 * scale.
 *
 * Geometry mirrors the AutomationBar overlay: 20×20 viewBox, ~70%
 * arc, 1.1s linear infinite spin, accent stroke. The `aria-label`
 * defaults to `"running"` so existing tests that locate the
 * spinner by label continue to work.
 */
function TabIconWithProgressRing({
  icon,
  active,
  label = "running",
}: {
  icon: ReactNode;
  active: boolean;
  label?: string;
}) {
  return (
    <span className={styles.tabIconWithProgressRing}>
      {icon}
      {active && (
        <svg
          className={styles.tabProgressRing}
          viewBox="0 0 20 20"
          role="img"
          aria-label={label}
          data-testid="tab-progress-ring"
        >
          <circle
            cx={10}
            cy={10}
            r={8}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={50.27}
            strokeDashoffset={35.2}
          />
        </svg>
      )}
    </span>
  );
}

export function SidekickTaskbar() {
  const { activeTab, setActiveTab, showInfo, toggleInfo } = useSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
      showInfo: s.showInfo,
      toggleInfo: s.toggleInfo,
    })),
  );
  const ctx = useProjectActions();
  const { features } = useAuraCapabilities();
  const addTerminal = useTerminalPanelStore((s) => s.addTerminal);
  const addBrowserInstance = useBrowserPanelStore((s) => s.addInstance);
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath } = useTerminalTarget({ projectId, agentInstanceId });
  const canBrowseLocal = features.linkedWorkspace && !remoteAgentId && Boolean(workspacePath);
  const canBrowseRemote = Boolean(remoteAgentId) && Boolean(remoteWorkspacePath);
  const canBrowseFiles = canBrowseLocal || canBrowseRemote;
  // Tasks tab lights up whenever ANY loop is open for this (project,
  // agent_instance) — this covers the live task runs in this project.
  // Run tab uses a project-wide scope so cross-agent activity inside
  // the same project also surfaces on the shared Run tab.
  const tasksActivity = useLoopActivityStore(
    useShallow((s) => selectAgentInstanceActivity(s, agentInstanceId ?? null)),
  );
  const runActivity = useLoopActivityStore(
    useShallow((s) => selectProjectActivity(s, projectId ?? null)),
  );
  const tasksActive = !!tasksActivity && isLoopActivityActive(tasksActivity.status);
  const runActive = !!runActivity && isLoopActivityActive(runActivity.status);

  useEffect(() => {
    if (!canBrowseFiles && activeTab === "files") {
      setActiveTab("tasks");
    }
  }, [activeTab, canBrowseFiles, setActiveTab]);
  const project = ctx?.project;
  const handleArchive = ctx?.handleArchive;
  const tabs = useMemo<TabItem[]>(
    () => [
      { id: "sessions", icon: <MessageSquare size={16} />, title: "Sessions" },
      { id: "terminal", icon: <SquareTerminal size={16} />, title: "Terminal" },
      { id: "browser", icon: <Globe size={16} />, title: "Browser" },
      { id: "specs", icon: <File size={16} />, title: "Specs" },
      {
        id: "tasks",
        icon: tasksActive ? (
          <LoopProgress
            source={{ activity: tasksActivity }}
            size={16}
            className={styles.automationSpinner}
          />
        ) : (
          <Check size={16} />
        ),
        title: "Tasks",
      },
      {
        id: "run",
        // Keep the Play glyph visible at all times and overlay a
        // rotating ring when the loop is active. Swapping Play for a
        // bare LoopProgress circle made the tab unreadable at 16px —
        // users couldn't tell the Run/Play tab apart from "some
        // running indicator" once the loop started. The overlay
        // preserves the affordance and the ring still communicates
        // "currently doing work".
        icon: (
          <TabIconWithProgressRing icon={<Play size={16} />} active={runActive} />
        ),
        title: "Run",
      },
      { id: "stats", icon: <BarChart3 size={16} />, title: "Stats" },
      { id: "log", icon: <ScrollText size={16} />, title: "Log" },
      { id: "files", icon: <FolderClosed size={16} />, title: "Files" },
      { id: "new-terminal", icon: <Plus size={16} />, title: "New terminal", kind: "action" },
      { id: "new-browser", icon: <Plus size={16} />, title: "New browser", kind: "action" },
    ],
    [tasksActive, runActive, tasksActivity, runActivity],
  );
  const visibleTabs = canBrowseFiles ? tabs : tabs.filter((tab) => tab.id !== "files");

  const actions = useMemo<MenuItem[]>(() => {
    if (!project) return [];
    return [
      ...(project.current_status !== "archived"
        ? [{ id: "archive", label: "Archive", icon: <Archive size={14} /> }]
        : []),
      { id: "info", label: "Project Info", icon: <Info size={14} /> },
    ];
  }, [project]);

  if (showInfo) return null;

  const handleAction = (id: string) => {
    if (id === "archive") handleArchive?.();
    if (id === "info") toggleInfo("Project Info", null);
  };

  const handleInlineAction = (id: string) => {
    if (id === "new-terminal") {
      addTerminal();
      setActiveTab("terminal");
      return;
    }
    if (id === "new-browser") {
      addBrowserInstance();
      setActiveTab("browser");
    }
  };

  return (
    <SidekickTabBar
      tabs={visibleTabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as SidekickTab)}
      onInlineAction={handleInlineAction}
      actions={actions}
      onAction={handleAction}
      alwaysShowMore={!!project}
    />
  );
}
