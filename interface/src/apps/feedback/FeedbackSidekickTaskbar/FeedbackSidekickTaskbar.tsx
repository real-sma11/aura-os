import { Info, MessageSquare } from "lucide-react";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar/SidekickTabBar";
import {
  useFeedbackItem,
  useFeedbackStore,
} from "../../../stores/feedback-store";
import type { FeedbackSidekickTab } from "../../../stores/feedback-store";

const TABS: readonly TabItem[] = [
  { id: "details", icon: <Info size={16} />, title: "Details" },
  { id: "comments", icon: <MessageSquare size={16} />, title: "Comments" },
];

function isFeedbackSidekickTab(id: string): id is FeedbackSidekickTab {
  return id === "details" || id === "comments";
}

/**
 * Top-of-sidekick tab bar for the Feedback app. Mirrors the Notes / Projects
 * pattern: a row of icon tabs that drive a single store-owned active tab.
 * Hidden until the user has selected a feedback item, since neither tab has
 * anything to show without a selection.
 */
export function FeedbackSidekickTaskbar() {
  const selectedId = useFeedbackStore((s) => s.selectedId);
  const item = useFeedbackItem(selectedId);
  const sidekickTab = useFeedbackStore((s) => s.sidekickTab);
  const setSidekickTab = useFeedbackStore((s) => s.setSidekickTab);

  if (!item) return null;

  return (
    <SidekickTabBar
      tabs={TABS}
      activeTab={sidekickTab}
      onTabChange={(id) => {
        if (isFeedbackSidekickTab(id)) setSidekickTab(id);
      }}
    />
  );
}
