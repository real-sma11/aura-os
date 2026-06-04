import { createElement } from "react";
import { Brain } from "lucide-react";
import { AgentList } from "./AgentList";
import { AgentMainPanel } from "./AgentMainPanel";
import { AgentInfoPanel } from "./AgentInfoPanel";
import { AgentSidekickTaskbar } from "./AgentSidekickTaskbar";
import { useAgentStore } from "./stores";
import type { AuraAppModule } from "../types";

const AgentsLeftPanel = () => createElement(AgentList, { mode: "default" });
const AgentsResponsiveControls = () =>
  createElement(AgentList, { mode: "responsive-controls" });

export const AgentsApp: AuraAppModule = {
  id: "agents",
  label: "Agents",
  icon: Brain,
  basePath: "/agents",
  LeftPanel: AgentsLeftPanel,
  // Also exposed as a shared desktop left-menu pane so the agents list
  // participates in `LeftMenu`'s keep-alive (kept mounted, hidden via
  // `display: none`) instead of unmounting on every Agents <-> Projects
  // switch. Same list the `LeftPanel` renders.
  DesktopLeftMenuPane: AgentsLeftPanel,
  MainPanel: AgentMainPanel,
  ResponsiveControls: AgentsResponsiveControls,
  SidekickPanel: AgentInfoPanel,
  SidekickTaskbar: AgentSidekickTaskbar,
  searchPlaceholder: "Search",
  onPrefetch: () => {
    useAgentStore.getState().fetchAgents().catch(() => {});
  },
};
