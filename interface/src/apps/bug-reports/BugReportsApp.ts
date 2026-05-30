import { ShieldAlert } from "lucide-react";
import { BugReportsList } from "./BugReportsList";
import { BugReportsMainPanel } from "./BugReportsMainPanel";
import type { AuraAppModule } from "../types";

export const BugReportsApp: AuraAppModule = {
  id: "bug-reports",
  label: "Bug Reports",
  icon: ShieldAlert,
  basePath: "/bug-reports",
  adminOnly: true,
  LeftPanel: BugReportsList,
  MainPanel: BugReportsMainPanel,
  ResponsiveControls: BugReportsList,
};
