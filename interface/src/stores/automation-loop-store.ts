import { create } from "zustand";

import type { ProjectId } from "../shared/types";
import { loadPersistedModel } from "../constants/models";

/**
 * Tracks the `agent_instance_id` the project's automation loop is
 * currently bound to, keyed by project. The AutomationBar populates
 * this from:
 *
 * 1. The `Loop`-role agent instance returned by `listAgentInstances`
 *    on first mount (so a previously-running loop is still
 *    controllable after a page reload), and
 * 2. The `agent_instance_id` returned by `startLoop` whenever the user
 *    starts the loop fresh.
 *
 * Subsequent pause/resume/stop calls scope themselves to that id so
 * concurrent ad-hoc task runs (which mint their own ephemeral
 * `Executor` instances) and the main chat thread (which lives on the
 * project's `Chat` instance) are never collateral damage when the
 * user hits Pause / Stop on the automation bar.
 *
 * The store is a project → id map rather than a single global slot so
 * the user can have one automation loop running per project at the
 * same time without the bound id flipping when they switch projects.
 *
 * On `LoopStopped` / `LoopFinished` for a bound loop the AutomationBar
 * clears the entry; the Loop-role `project_agents` row itself
 * survives so the next start reuses the same id.
 *
 * The `modelByProject` slice tracks the model the user has picked in
 * the AutomationBar's own `ModelPicker`. It is deliberately *not*
 * derived from the chat input bar's selection: the loop should run on
 * whichever model the user picked for the loop, regardless of which
 * chat thread they happen to be looking at. The value is persisted to
 * `localStorage` (key: `aura-automation-model:project:<projectId>`)
 * so the choice survives reloads; lazy hydration on first read keeps
 * the constructor lean. A `null` entry means "no explicit pick yet —
 * let the backend fall back to the bound `Loop` agent instance's
 * stored `default_model`".
 */
interface AutomationLoopState {
  /** projectId → bound loop `agent_instance_id`, or `null` if the
   *  project does not yet have a Loop instance allocated. */
  loopByProject: Record<string, string | null>;

  /**
   * projectId → user-picked chat model for this project's automation
   * loop, or `null` if nothing has been picked yet (in which case the
   * backend falls back to the bound Loop agent's stored default).
   *
   * Entries are lazily hydrated from `localStorage` on first read via
   * `getLoopModel`; explicit writes through `setLoopModel` persist
   * back to `localStorage` so refreshes preserve the pick.
   */
  modelByProject: Record<string, string | null>;

  setLoopAgent: (projectId: ProjectId, agentInstanceId: string | null) => void;
  clearLoopAgent: (projectId: ProjectId) => void;
  getLoopAgent: (projectId: ProjectId) => string | null;
  setLoopModel: (projectId: ProjectId, modelId: string | null) => void;
  getLoopModel: (projectId: ProjectId) => string | null;
  reset: () => void;
}

const MODEL_LS_KEY_PREFIX = "aura-automation-model:project:";

function modelStorageKey(projectId: ProjectId): string {
  return `${MODEL_LS_KEY_PREFIX}${projectId}`;
}

function loadPersistedAutomationModel(projectId: ProjectId): string | null {
  try {
    const value = localStorage.getItem(modelStorageKey(projectId));
    if (value && value.length > 0) return value;
  } catch {
    // localStorage may be unavailable (private mode, SSR, …)
  }
  return null;
}

function persistAutomationModel(
  projectId: ProjectId,
  modelId: string | null,
): void {
  try {
    if (modelId == null) {
      localStorage.removeItem(modelStorageKey(projectId));
    } else {
      localStorage.setItem(modelStorageKey(projectId), modelId);
    }
  } catch {
    // localStorage may be unavailable
  }
}

export const useAutomationLoopStore = create<AutomationLoopState>((set, get) => ({
  loopByProject: {},
  modelByProject: {},
  setLoopAgent: (projectId, agentInstanceId) =>
    set((state) => ({
      loopByProject: { ...state.loopByProject, [projectId]: agentInstanceId },
    })),
  clearLoopAgent: (projectId) =>
    set((state) => {
      if (!(projectId in state.loopByProject)) return state;
      const next = { ...state.loopByProject };
      delete next[projectId];
      return { loopByProject: next };
    }),
  getLoopAgent: (projectId) => get().loopByProject[projectId] ?? null,
  setLoopModel: (projectId, modelId) => {
    persistAutomationModel(projectId, modelId);
    set((state) => ({
      modelByProject: { ...state.modelByProject, [projectId]: modelId },
    }));
  },
  getLoopModel: (projectId) => {
    // Read the in-memory map first; fall through to localStorage so
    // refreshes restore the previous pick without an explicit
    // hydration pass. Pure read — never mutates the store — so it's
    // safe to call from selectors during render.
    const inMemory = get().modelByProject[projectId];
    if (inMemory !== undefined) return inMemory;
    return loadPersistedAutomationModel(projectId);
  },
  reset: () => set({ loopByProject: {}, modelByProject: {} }),
}));

/**
 * Hook-shaped accessor for the automation loop's model selection.
 *
 * Returns the currently-selected model id for this project (or `null`
 * when nothing has been picked yet) plus a stable setter that
 * persists to `localStorage`. The selector falls back to
 * `localStorage` when the in-memory map has no entry yet, so the
 * first render after a refresh shows the persisted pick without any
 * explicit hydration step — and the read stays free of side
 * effects, which keeps React 18 strict-mode double-invocation safe.
 */
export function useAutomationModel(projectId: ProjectId): {
  model: string | null;
  setModel: (modelId: string | null) => void;
} {
  const model = useAutomationLoopStore((s) => {
    const inMemory = s.modelByProject[projectId];
    if (inMemory !== undefined) return inMemory;
    return loadPersistedAutomationModel(projectId) ?? loadPersistedModel("aura_harness");
  });
  const setLoopModel = useAutomationLoopStore((s) => s.setLoopModel);
  return {
    model,
    setModel: (modelId) => setLoopModel(projectId, modelId),
  };
}
