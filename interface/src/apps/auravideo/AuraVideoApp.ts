import { Film } from "lucide-react";
import { AuraVideoMainPanel } from "./AuraVideoMainPanel/AuraVideoMainPanel";
import type { AuraAppModule } from "../types";

export const AuraVideoApp: AuraAppModule = {
  id: "auravideo",
  label: "AURA Video",
  icon: Film,
  basePath: "/video",
  MainPanel: AuraVideoMainPanel,
};
