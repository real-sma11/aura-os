import { useEffect } from "react";
import { api } from "../api/client";
import {
  useEventStore,
  useTaskOutput,
  getCachedTaskOutputText,
  type TaskOutputEntry,
} from "../stores/event-store/index";
import { hydrateTaskOutputOnce } from "../stores/task-output-hydration-cache";
import {
  persistTaskTurns,
  readTaskTurns,
} from "../stores/task-turn-cache";
import { taskStreamKey } from "../stores/task-stream-bootstrap";
import { seedStreamEventsFromCache } from "./stream/store";
import { useStreamEvents } from "./stream/hooks";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { useTaskOutputPanelStore } from "../stores/task-output-panel-store";
import { useTaskStatusStore } from "../stores/task-status-store";
import { useShallow } from "zustand/react/shallow";
import { mapBuildSteps, mapTestSteps, mapGitSteps } from "./task-step-mapping";
import { buildDisplayEvents } from "../utils/build-display-messages";

/* ------------------------------------------------------------------ */
/*  Unified task output view                                           */
/*                                                                     */
/*  Collapses the four-layer storage model (stream store, event        */
/*  store, persistent turn cache, server) into a single reactive view  */
/*  for consumers. Load order:                                         */
/*                                                                     */
/*    1. Live stream-store entry (events, text, build/test/git steps). */
/*    2. Persisted turn cache (task-turn-cache) — rehydrated into the  */
/*       stream store so MessageBubble / LLMOutput render full         */
/*       structure (timeline, tool cards, thinking).                   */
/*    3. Event-store `taskOutput.text` (text-only fallback, already    */
/*       persisted to localStorage via task-output-cache).             */
/*    4. Server hydration:                                             */
/*       a. `api.getTaskOutput` for text + build/test/git steps.       */
/*       b. `api.listSessionEvents` for the structured turn timeline   */
/*          (only when the task carries a `session_id` and the         */
/*          structured cache is still empty afterwards).               */
/*       Both are single-flight'd through the existing hydration       */
/*       cache so orphan runs never loop.                              */
/*                                                                     */
/*  The hook also persists the freshly-materialized events back into   */
/*  the turn cache whenever the live stream gains a new finalized      */
/*  event for a terminal task, so in-session work stays saved even     */
/*  if the terminal bus misses a TaskCompleted broadcast.              */
/* ------------------------------------------------------------------ */

export interface TaskOutputView {
  streamKey: string;
  events: DisplaySessionEvent[];
  taskOutput: TaskOutputEntry;
  fallbackText: string;
  hasStructuredContent: boolean;
  hasAnyContent: boolean;
}

interface TaskAddressing {
  sessionId: string | undefined;
  agentInstanceId: string | undefined;
}

/**
 * Resolve the `(sessionId, agentInstanceId)` pair this hook needs to
 * call `api.listSessionEvents`. Pulls live values from the
 * `task-status-store` (set by `TaskStarted` handlers) and falls back to
 * whatever the Run-panel entry has (populated by
 * `useProjectLayoutData` from the server `Task` row).
 */
function useTaskAddressing(taskId: string | undefined): TaskAddressing {
  const liveSessionId = useTaskStatusStore((s) =>
    taskId ? (s.byTaskId[taskId]?.liveSessionId ?? null) : null,
  );
  const panelEntry = useTaskOutputPanelStore(
    useShallow((s) => {
      if (!taskId) return null;
      const t = s.tasks.find((row) => row.taskId === taskId);
      if (!t) return null;
      return {
        sessionId: t.sessionId,
        agentInstanceId: t.agentInstanceId,
      };
    }),
  );
  return {
    sessionId: liveSessionId ?? panelEntry?.sessionId ?? undefined,
    agentInstanceId: panelEntry?.agentInstanceId ?? undefined,
  };
}

export function useTaskOutputView(
  taskId: string | undefined,
  projectId: string | undefined,
  isTerminal: boolean,
): TaskOutputView {
  const streamKey = taskId ? taskStreamKey(taskId) : "task:";
  const events = useStreamEvents(streamKey);
  const taskOutput = useTaskOutput(taskId);
  const seedTaskOutput = useEventStore((s) => s.seedTaskOutput);
  const { sessionId, agentInstanceId } = useTaskAddressing(taskId);

  // 1. Seed the stream-store events from the persisted turn cache the
  //    first time a terminal row mounts while the live entry is empty.
  useEffect(() => {
    if (!taskId) return;
    if (!isTerminal) return;
    if (events.length > 0) return;
    let cancelled = false;
    void (async () => {
      const cached = await readTaskTurns(taskId, projectId);
      if (cancelled) return;
      if (cached.length > 0) {
        seedStreamEventsFromCache(streamKey, cached);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, projectId, isTerminal, events.length, streamKey]);

  // 2. Hydrate text / build / test / git steps from localStorage +
  //    server when nothing structured is available.
  useEffect(() => {
    if (!taskId || !projectId) return;
    if (!isTerminal) return;
    // If we already have structured events, skip the text hydration —
    // the events already contain the rendered turn. We still run the
    // text path when events are empty so the "raw text" fallback has
    // something to show if the turn cache is also empty.
    if (events.length > 0) return;

    let cancelled = false;
    void (async () => {
      const existing = useEventStore.getState().taskOutputs[taskId];
      if (!existing?.text) {
        const cached = await getCachedTaskOutputText(taskId, projectId);
        if (cancelled) return;
        if (cached) {
          seedTaskOutput(taskId, cached, undefined, undefined, undefined, projectId);
        }
      }
    })();

    void hydrateTaskOutputOnce(projectId, taskId, async () => {
      const current = useEventStore.getState().taskOutputs[taskId];
      const hasStructuredStateAlready =
        !!current?.text ||
        (current?.buildSteps?.length ?? 0) > 0 ||
        (current?.testSteps?.length ?? 0) > 0 ||
        (current?.gitSteps?.length ?? 0) > 0;
      if (hasStructuredStateAlready) return "loaded";
      try {
        const res = await api.getTaskOutput(projectId, taskId);
        if (cancelled) return "empty";
        // Parity with `useTaskOutputHydration` (Tasks tab): the server
        // returns structured `build_steps` / `test_steps` / `git_steps`
        // alongside the raw text. Previously the Run pane silently
        // dropped these on the floor — `seedTaskOutput(..., undefined,
        // undefined, undefined, ...)` — so a row whose only output was
        // a cargo command's stderr/stdout would fall through to the
        // "No output captured" empty state. Map and forward them too.
        const loadedBuildSteps = res.build_steps?.length
          ? mapBuildSteps(res.build_steps)
          : undefined;
        const loadedTestSteps = res.test_steps?.length
          ? mapTestSteps(res.test_steps)
          : undefined;
        const loadedGitSteps = res.git_steps?.length
          ? mapGitSteps(res.git_steps)
          : undefined;
        if (
          res.output ||
          loadedBuildSteps?.length ||
          loadedTestSteps?.length ||
          loadedGitSteps?.length
        ) {
          seedTaskOutput(
            taskId,
            res.output,
            loadedBuildSteps,
            loadedTestSteps,
            loadedGitSteps,
            projectId,
          );
          return "loaded";
        }
        return "empty";
      } catch {
        return "empty";
      }
    });

    return () => {
      cancelled = true;
    };
  }, [taskId, projectId, isTerminal, events.length, seedTaskOutput]);

  // 3. Server-side structured-turn rehydration. Authoritative fallback
  //    for tasks that completed outside the current UI session: a
  //    background dev-loop / SDK run that this client never streamed,
  //    or a page reload after the local `task-turn-cache` (60-entry
  //    cap, 30d TTL) was evicted. We pull the persisted session
  //    events, normalise them through `buildDisplayEvents`, and seed
  //    the stream store so `MessageBubble` renders the full timeline
  //    just like a live finalize would have produced.
  //
  //    Gated on `sessionId` because a task that never reached
  //    `task_started` server-side has no session to replay from.
  //    Single-flighted via a dedicated `hydrateTaskOutputOnce` key
  //    suffix so the request fans out to at most one HTTP call per
  //    task even when multiple panels mount the same row.
  useEffect(() => {
    if (!taskId || !projectId) return;
    if (!isTerminal) return;
    if (events.length > 0) return;
    if (!sessionId || !agentInstanceId) return;

    let cancelled = false;
    const cacheKey = `${taskId}::session-events`;
    void hydrateTaskOutputOnce(projectId, cacheKey, async () => {
      // Re-check the live entry to avoid a redundant fetch when the
      // text-hydration path above (or a fresh WS event) already
      // populated the stream store between effect schedules.
      const liveEntry = useEventStore.getState().taskOutputs[taskId];
      const cached = await readTaskTurns(taskId, projectId);
      if (cancelled) return "empty";
      if (cached.length > 0) {
        seedStreamEventsFromCache(streamKey, cached);
        return "loaded";
      }
      // Short-circuit when we already have non-event content to
      // render — the structured rehydrate is only worth the round
      // trip when the row would otherwise show "No output captured".
      // Keeping the gate loose (always rehydrate when events are
      // empty) is intentional: build/test/git steps without the
      // assistant's narration is still a meaningfully worse view
      // than the full timeline replay.
      void liveEntry;
      try {
        const wireEvents = await api.listSessionEvents(
          projectId,
          agentInstanceId,
          sessionId,
        );
        if (cancelled) return "empty";
        const displayEvents = buildDisplayEvents(wireEvents);
        if (displayEvents.length === 0) return "empty";
        seedStreamEventsFromCache(streamKey, displayEvents);
        // Mirror into the persistent turn cache so the next mount of
        // this row (or a sibling panel on the same page) skips the
        // server round-trip entirely.
        persistTaskTurns(taskId, displayEvents, projectId);
        return "loaded";
      } catch {
        return "empty";
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    taskId,
    projectId,
    isTerminal,
    events.length,
    sessionId,
    agentInstanceId,
    streamKey,
  ]);

  // 4. Mirror newly-materialized events back into the persistent turn
  //    cache. The task-stream-bootstrap writes on the TaskCompleted /
  //    TaskFailed broadcast, but if the live entry gains more events
  //    afterwards (e.g. from a delayed save or from this component
  //    seeding them from the server in the future) we keep the cache
  //    in sync.
  useEffect(() => {
    if (!taskId) return;
    if (!isTerminal) return;
    if (events.length === 0) return;
    persistTaskTurns(taskId, events, projectId);
  }, [taskId, projectId, isTerminal, events]);

  const hasStructuredContent = events.length > 0;
  const fallbackText = taskOutput.text;
  const hasAnyContent =
    hasStructuredContent ||
    !!fallbackText ||
    (taskOutput.buildSteps?.length ?? 0) > 0 ||
    (taskOutput.testSteps?.length ?? 0) > 0 ||
    (taskOutput.gitSteps?.length ?? 0) > 0;

  return {
    streamKey,
    events,
    taskOutput,
    fallbackText,
    hasStructuredContent,
    hasAnyContent,
  };
}
