import { useEffect } from "react";
import { api } from "../api/client";
import {
  getTaskOutput,
  type BuildStep,
  type TestStep,
  type GitStep,
} from "../stores/event-store/index";
import { hydrateTaskOutputOnce } from "../stores/task-output-hydration-cache";
import type { Task } from "../shared/types";
import { mapBuildSteps, mapTestSteps, mapGitSteps } from "./task-step-mapping";

function hasInlineHydrationAlready(
  taskId: string,
  liveOutput: string,
  buildSteps: BuildStep[] | undefined,
  testSteps: TestStep[] | undefined,
): boolean {
  const existing = getTaskOutput(taskId);
  const hasLiveOutput =
    !liveOutput || existing.text === liveOutput || existing.text.includes(liveOutput);
  const hasBuildSteps =
    !buildSteps?.length || existing.buildSteps.length > 0;
  const hasTestSteps =
    !testSteps?.length || existing.testSteps.length > 0;
  return hasLiveOutput && hasBuildSteps && hasTestSteps;
}

/**
 * Hydrates task output from persisted data (inline on the task) or by
 * fetching from the API when needed.
 *
 * Hydration is deduplicated across all consumers of the same (projectId,
 * taskId) via the shared hydration cache, so rendering this hook from
 * many rows at once issues at most one HTTP request per task. Empty
 * server responses are treated as terminal "no output" and never blindly
 * retried; a subsequent `TaskStarted` event invalidates the cache so the
 * next mount will refetch.
 */
export function useTaskOutputHydration(
  projectId: string | undefined,
  task: Task,
  isActive: boolean,
  isTerminal: boolean,
  streamBuf: string,
  seedTaskOutput: (taskId: string, text: string, buildSteps?: BuildStep[], testSteps?: TestStep[], gitSteps?: GitStep[]) => void,
): void {
  useEffect(() => {
    if (!projectId) return;
    if (streamBuf) return;

    const persistedBuildSteps = task.build_steps?.length
      ? mapBuildSteps(task.build_steps)
      : undefined;
    const persistedTestSteps = task.test_steps?.length
      ? mapTestSteps(task.test_steps)
      : undefined;

    if (!(isTerminal || isActive || task.status === "in_progress")) return;

    const liveOutput = task.live_output ?? "";
    if (liveOutput || persistedBuildSteps?.length || persistedTestSteps?.length) {
      if (!hasInlineHydrationAlready(
        task.task_id,
        liveOutput,
        persistedBuildSteps,
        persistedTestSteps,
      )) {
        seedTaskOutput(task.task_id, liveOutput, persistedBuildSteps, persistedTestSteps);
      }
      return;
    }

    void hydrateTaskOutputOnce(projectId, task.task_id, async () => {
      try {
        const res = await api.getTaskOutput(projectId, task.task_id);
        const loadedBuildSteps = res.build_steps ? mapBuildSteps(res.build_steps) : undefined;
        const loadedTestSteps = res.test_steps ? mapTestSteps(res.test_steps) : undefined;
        const loadedGitSteps = res.git_steps ? mapGitSteps(res.git_steps) : undefined;
        if (res.output || loadedBuildSteps?.length || loadedTestSteps?.length || loadedGitSteps?.length) {
          seedTaskOutput(task.task_id, res.output, loadedBuildSteps, loadedTestSteps, loadedGitSteps);
          return "loaded";
        }
        return "empty";
      } catch (err) {
        console.warn("Failed to load task output:", err);
        return "empty";
      }
    });
  }, [isActive, isTerminal, projectId, task.task_id, task.status, task.live_output, task.build_steps, task.test_steps, streamBuf, seedTaskOutput]);
}
