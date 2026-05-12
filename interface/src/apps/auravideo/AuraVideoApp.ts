import { Film } from "lucide-react";
import { AuraVideoMainPanel } from "./AuraVideoMainPanel/AuraVideoMainPanel";
import { AuraVideoNav } from "./AuraVideoNav/AuraVideoNav";
import { AuraVideoSidekickPanel } from "./AuraVideoSidekickPanel/AuraVideoSidekickPanel";
import { AuraVideoSidekickTaskbar } from "./AuraVideoSidekickTaskbar/AuraVideoSidekickTaskbar";
import type { AuraAppModule } from "../types";

export const AuraVideoApp: AuraAppModule = {
  id: "auravideo",
  label: "AURA Video",
  icon: Film,
  basePath: "/video",
  LeftPanel: AuraVideoNav,
  MainPanel: AuraVideoMainPanel,
  ResponsiveControls: AuraVideoNav,
  SidekickPanel: AuraVideoSidekickPanel,
  SidekickTaskbar: AuraVideoSidekickTaskbar,
};
