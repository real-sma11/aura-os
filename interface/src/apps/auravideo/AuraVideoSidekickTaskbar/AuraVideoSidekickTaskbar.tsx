import { Film } from "lucide-react";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar";

const TABS: readonly TabItem[] = [
  { id: "videos", icon: <Film size={16} />, title: "Videos" },
];

export function AuraVideoSidekickTaskbar() {
  return <SidekickTabBar tabs={TABS} activeTab="videos" onTabChange={() => {}} />;
}
