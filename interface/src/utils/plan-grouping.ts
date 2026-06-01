import type { Spec } from "../shared/types";
import type { Plan } from "../stores/plan-store";
import { compareSpecs } from "./collections";

export interface PlanGroup {
  plan_id: string;
  title: string;
  summary?: string;
  specs: Spec[];
}

/** Synthetic group id for specs that predate any recorded plan run. */
export const DEFAULT_PLAN_ID = "__default_plan__";

/**
 * Group specs under their owning Plan. Specs are claimed by the recorded
 * plans (one per generation run); anything left over — e.g. specs that
 * existed before plan tracking, or were loaded from the server this
 * session — collapses into a single default group named by the project's
 * current plan title. Groups are returned with the default group first,
 * then recorded plans oldest-to-newest, so the list reads top-down.
 */
export function groupSpecsByPlan(
  specs: Spec[],
  plans: Plan[],
  defaultTitle: string,
): PlanGroup[] {
  const specById = new Map(specs.map((s) => [s.spec_id, s]));
  const claimed = new Set<string>();
  const planGroups: PlanGroup[] = [];

  const orderedPlans = [...plans].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );

  for (const plan of orderedPlans) {
    const planSpecs: Spec[] = [];
    for (const id of plan.spec_ids) {
      const spec = specById.get(id);
      if (spec && !claimed.has(id)) {
        planSpecs.push(spec);
        claimed.add(id);
      }
    }
    if (planSpecs.length === 0) continue;
    planGroups.push({
      plan_id: plan.plan_id,
      title: plan.title || defaultTitle,
      summary: plan.summary,
      specs: planSpecs.sort(compareSpecs),
    });
  }

  const groups: PlanGroup[] = [];
  const unclaimed = specs.filter((s) => !claimed.has(s.spec_id));
  if (unclaimed.length > 0) {
    groups.push({
      plan_id: DEFAULT_PLAN_ID,
      title: defaultTitle,
      specs: unclaimed.sort(compareSpecs),
    });
  }
  groups.push(...planGroups);
  return groups;
}
