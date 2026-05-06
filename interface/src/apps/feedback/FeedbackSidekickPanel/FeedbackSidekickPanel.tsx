import { Info } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import {
  useFeedbackItem,
  useFeedbackStore,
} from "../../../stores/feedback-store";
import { FeedbackCommentsPanel } from "../FeedbackCommentsPanel";
import { FeedbackDetailsPanel } from "../FeedbackDetailsPanel";

/**
 * Tab router for the Feedback sidekick. Mirrors the Notes pattern: when an
 * item is selected, picks between the Details and Comments panels based on
 * the active sidekick tab; when nothing is selected, renders a single empty
 * state regardless of which tab is "active" so the user is prompted to pick
 * a feedback item before either panel takes over.
 */
export function FeedbackSidekickPanel() {
  const selectedId = useFeedbackStore((s) => s.selectedId);
  const sidekickTab = useFeedbackStore((s) => s.sidekickTab);
  const item = useFeedbackItem(selectedId);

  if (!item) {
    return (
      <EmptyState icon={<Info size={32} />}>
        Select a feedback item to view details
      </EmptyState>
    );
  }

  if (sidekickTab === "comments") return <FeedbackCommentsPanel />;
  return <FeedbackDetailsPanel />;
}
