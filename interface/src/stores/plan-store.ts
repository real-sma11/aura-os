import { create } from "zustand";

/**
 * A `Plan` is a frontend-only grouping of the specs produced by a single
 * plan-generation run. The real spec records live in aura-storage and only
 * carry a `project_id`; this store derives the Plan -> Specs relationship on
 * the client and persists it to `localStorage` so the grouping survives
 * reloads without any backend schema changes.
 */
export interface Plan {
  plan_id: string;
  project_id: string;
  title: string;
  summary?: string;
  /** Spec ids captured during this run, in arrival order. */
  spec_ids: string[];
  created_at: string;
}

const STORAGE_KEY = "aura-plans-by-project";

function newPlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadPlans(): Record<string, Plan[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Plan[]>) : {};
  } catch {
    return {};
  }
}

function persist(plansByProject: Record<string, Plan[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plansByProject));
  } catch {
    // localStorage may be unavailable (private mode / quota) — grouping
    // simply falls back to the in-memory copy for this session.
  }
}

interface PlanState {
  plansByProject: Record<string, Plan[]>;
  /** In-progress run, keyed by project, finalized into `plansByProject`. */
  draftByProject: Record<string, Plan>;

  /** Open a fresh plan draft for a run (clears any unfinished draft). */
  beginRun: (projectId: string) => void;
  /** Attach a saved spec to the current run's draft. */
  recordSpec: (projectId: string, specId: string) => void;
  /** Commit the current run's draft as a Plan with the given title/summary. */
  finalizeRun: (
    projectId: string,
    meta?: { title?: string; summary?: string },
  ) => void;
  getPlans: (projectId: string) => Plan[];
}

export const usePlanStore = create<PlanState>()((set, get) => ({
  plansByProject: loadPlans(),
  draftByProject: {},

  beginRun: (projectId) => {
    if (!projectId) return;
    set((s) => ({
      draftByProject: {
        ...s.draftByProject,
        [projectId]: {
          plan_id: newPlanId(),
          project_id: projectId,
          title: "",
          spec_ids: [],
          created_at: new Date().toISOString(),
        },
      },
    }));
  },

  recordSpec: (projectId, specId) => {
    // Ignore optimistic placeholders — they have no stable server identity
    // and get evicted once the real `spec_saved` lands.
    if (!projectId || !specId || specId.startsWith("pending-")) return;
    set((s) => {
      // A lone `create_spec` (outside a generate run) still gets grouped by
      // opening an implicit draft on first spec.
      const draft =
        s.draftByProject[projectId] ?? {
          plan_id: newPlanId(),
          project_id: projectId,
          title: "",
          spec_ids: [],
          created_at: new Date().toISOString(),
        };
      if (draft.spec_ids.includes(specId)) return s;
      return {
        draftByProject: {
          ...s.draftByProject,
          [projectId]: { ...draft, spec_ids: [...draft.spec_ids, specId] },
        },
      };
    });
  },

  finalizeRun: (projectId, meta) => {
    if (!projectId) return;
    set((s) => {
      const draft = s.draftByProject[projectId];
      const nextDraft = { ...s.draftByProject };
      delete nextDraft[projectId];
      // Nothing collected — just drop the empty draft.
      if (!draft || draft.spec_ids.length === 0) {
        return { draftByProject: nextDraft };
      }
      const finalized: Plan = {
        ...draft,
        title: meta?.title?.trim() || draft.title || "Plan",
        summary: meta?.summary ?? draft.summary,
      };
      const existing = s.plansByProject[projectId] ?? [];
      const nextPlans = {
        ...s.plansByProject,
        [projectId]: [...existing, finalized],
      };
      persist(nextPlans);
      return { plansByProject: nextPlans, draftByProject: nextDraft };
    });
  },

  getPlans: (projectId) => get().plansByProject[projectId] ?? [],
}));
