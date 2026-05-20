import type {
  FeedbackCategory,
  FeedbackSort,
  FeedbackStatus,
} from "../../../api/marketing/feedback";

export interface FeedbackFilterOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly iconName: string;
}

export const FEEDBACK_SORT_FILTERS: ReadonlyArray<
  FeedbackFilterOption<FeedbackSort>
> = [
  { id: "latest", label: "Latest", iconName: "Clock" },
  { id: "popular", label: "Most Popular", iconName: "Star" },
  { id: "trending", label: "Trending", iconName: "Flame" },
  { id: "most_voted", label: "Most Voted", iconName: "TrendingUp" },
  { id: "least_voted", label: "Least Voted", iconName: "TrendingDown" },
];

export const FEEDBACK_CATEGORY_FILTERS: ReadonlyArray<
  FeedbackFilterOption<FeedbackCategory>
> = [
  { id: "feature_request", label: "Feature Request", iconName: "Sparkles" },
  { id: "bug", label: "Bug", iconName: "Bug" },
  { id: "ui_ux", label: "UI/UX", iconName: "Palette" },
  { id: "feedback", label: "Feedback", iconName: "MessageCircle" },
  { id: "question", label: "Question", iconName: "HelpCircle" },
];

export const FEEDBACK_STATUS_FILTERS: ReadonlyArray<
  FeedbackFilterOption<FeedbackStatus>
> = [
  { id: "not_started", label: "Not Started", iconName: "CircleDashed" },
  { id: "in_review", label: "In Review", iconName: "Eye" },
  { id: "in_progress", label: "In Progress", iconName: "CircleDot" },
  { id: "done", label: "Done", iconName: "CheckCircle2" },
  { id: "deployed", label: "Deployed", iconName: "Rocket" },
];

export const FEEDBACK_ALL_CATEGORY_OPTION: FeedbackFilterOption<"all"> = {
  id: "all",
  label: "All Types",
  iconName: "Layers",
};

export const FEEDBACK_ALL_STATUS_OPTION: FeedbackFilterOption<"all"> = {
  id: "all",
  label: "All Statuses",
  iconName: "Globe",
};

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  feature_request: "Feature Request",
  bug: "Bug",
  ui_ux: "UI/UX",
  feedback: "Feedback",
  question: "Question",
};

export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  not_started: "Not Started",
  in_review: "In Review",
  in_progress: "In Progress",
  done: "Done",
  deployed: "Deployed",
};