import { useEffect, useReducer, useRef, useCallback, useState } from "react";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import type { LoopStatusResponse } from "../../shared/api/loop";
import { useEventStore } from "../../stores/event-store/index";
import { useLoopActivityStore } from "../../stores/loop-activity-store";
import { useTaskOutputPanelStore } from "../../stores/task-output-panel-store";
import {
  useAutomationLoopStore,
  useAutomationModel,
} from "../../stores/automation-loop-store";
import type { ProjectId } from "../../shared/types";
import { EventType } from "../../shared/types/aura-events";
import {
  agentsOf,
  automationReducer,
  canPause as canPauseFn,
  canPlay as canPlayFn,
  canStop as canStopFn,
  initialState,
  statusOf,
  type AutomationStatus,
} from "./automation-state-machine";

/**
 * Seed the Run panel store with "active" rows for any tasks the
 * server reports as currently streaming. Runs on boot + WS reconnect
 * so the panel doesn't silently drop rows whose `task_started` event
 * fired before the current session connected. Scoped to the project
 * we just fetched status for so we don't touch rows from other projects.
 */
function hydrateActiveTasksFromLoopStatus(
  res: LoopStatusResponse,
  projectId: ProjectId,
): void {
  const active = res.active_tasks ?? [];
  const panel = useTaskOutputPanelStore.getState();
  // Reconcile BEFORE promoting the new rows: any locally-"active" row
  // for this project whose task the server no longer reports as active
  // is a leftover from a stopped / refreshed prior run, and would
  // otherwise render its own cooking indicator alongside the new run's
  // row. Demote to "interrupted" as a transient holding state -- the
  // subsequent `reconcilePanelStatuses` pass (driven by
  // `/projects/:pid/tasks`) upgrades it to `completed` / `failed` once
  // the authoritative per-task status loads.
  const keepIds = active.map((t) => t.task_id).filter(Boolean);
  panel.demoteStaleActive(projectId, keepIds);
  for (const entry of active) {
    if (!entry.task_id) continue;
    panel.hydrateActiveTask(entry.task_id, projectId, entry.agent_instance_id);
  }
}

/**
 * Seed the Run-panel row store from the response body of
 * `/loop/start` (or `/loop/resume`) so the panel appears immediately
 * -- without waiting for the corresponding `task_started` WebSocket
 * event. The Tasks-list per-row spinner is fed by the
 * `useLoopActivityStore`-derived `useLiveTaskIdsForProject` and does
 * not need a parallel start-response hydration: the backend's
 * `loop_opened` + `loop_activity_changed` WS events arrive within a
 * frame of the HTTP response and write `current_task_id` directly
 * onto the loop-activity store (now the single source of truth).
 */
function hydrateUiFromLoopStartResponse(
  res: LoopStatusResponse,
  projectId: ProjectId,
): void {
  hydrateActiveTasksFromLoopStatus(res, projectId);
}

/**
 * Project-scoped safety-net rehydrate of `loop-activity-store` after a
 * Start / Resume / Stop completes. The unified spinner (the
 * `LoopProgress` ring around the AutomationBar play button, per-task
 * row spinners, etc.) is normally driven by the
 * `loop_opened` / `loop_activity_changed` / `loop_ended` WS events,
 * but rapid Stop+Start cycles can race those events: the server may
 * have emitted `loop_started` (the legacy event the AutomationBar
 * listens to) and inserted a fresh `loop_registry` entry, but the
 * client hasn't received the matching `loop_opened` yet -- or worse,
 * inherited a stale activity row from a now-cancelled loop instance.
 *
 * Calling `hydrate({ project_id })` on every Start / Stop click
 * collapses the window to a single HTTP round-trip, so the spinner
 * snaps to authoritative server state without waiting on WS reconnect
 * or the per-client stall watchdog. Scoped to the project so
 * concurrent loops in other projects are untouched (matches the
 * `replaceSnapshot` merge-by-filter semantics in
 * [`loop-activity-store.ts`]).
 */
function rehydrateLoopActivityForProject(projectId: ProjectId): void {
  void useLoopActivityStore.getState().hydrate({ project_id: projectId });
}

interface AutomationStatusData {
  status: AutomationStatus;
  agentCount: number;
  canPlay: boolean;
  canPause: boolean;
  canStop: boolean;
  starting: boolean;
  preparing: boolean;
  confirmStop: boolean;
  setConfirmStop: (v: boolean) => void;
  handleStart: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleStop: () => void;
  handleStopConfirm: () => Promise<void>;
  stopError: string | null;
  clearStopError: () => void;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return fallback;
}

export function useAutomationStatus(projectId: ProjectId): AutomationStatusData {
  const subscribe = useEventStore((s) => s.subscribe);
  const connected = useEventStore((s) => s.connected);
  // Model the user picked in the AutomationBar's own picker. This is
  // deliberately independent of whichever chat thread is in the URL --
  // the loop's model is the loop's own per-project setting, not a
  // side effect of which chat tab happens to be visible. A `null`
  // here means "let the backend fall back to the bound Loop agent's
  // stored default_model".
  const { model: selectedModel } = useAutomationModel(projectId);

  // Single source of truth for the four previously-implicit-coupled
  // booleans (`activeAgents`, `paused`, `starting`, `preparing`).
  // Each WS subscription dispatches exactly one action; status,
  // agentCount, and the canPlay/canPause/canStop button gates are
  // pure derivations off this state. See `automation-state-machine.ts`
  // for the transition table.
  const [state, dispatch] = useReducer(automationReducer, initialState);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  // Bound `Loop`-role agent instance id for this project. Read by all
  // pause / resume / stop paths so the harness's "one in-flight turn
  // per agent_id" rule never collides with the active chat thread or
  // a parallel ad-hoc task run (each of which keeps its own
  // `agent_instance_id`).
  const boundLoopId = useAutomationLoopStore((s) => s.loopByProject[projectId] ?? null);
  const setBoundLoopId = useAutomationLoopStore((s) => s.setLoopAgent);

  const isForProject = useCallback(
    (event: { project_id?: string }) => event.project_id === projectId,
    [projectId],
  );

  const fetchLoopStatus = useCallback(() => {
    api.getLoopStatus(projectId)
      .then((res) => {
        dispatch({
          type: "statusFetched",
          agents: res.active_agent_instances ?? [],
          paused: Boolean(res.paused),
        });
        // Rehydrate Run panel rows from authoritative server state
        // so the "No tasks" emptiness after refresh doesn't stay out
        // of sync with the spinning nav icon. Any missed
        // `task_started` events are effectively replayed here.
        hydrateUiFromLoopStartResponse(res, projectId);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { fetchLoopStatus(); }, [fetchLoopStatus]);

  // Hydrate the bound Loop instance id from the project's agent
  // instances on mount. We run this independently of the loop status
  // fetch so the pause / stop buttons can target the right agent
  // even on the very first render after a refresh -- before the user
  // has interacted with Start. Failure (offline, fresh project) is
  // non-fatal: the next `startLoop` response refreshes the binding.
  useEffect(() => {
    let cancelled = false;
    api.listAgentInstances(projectId)
      .then((instances) => {
        if (cancelled) return;
        const loop = instances.find((i) => i.instance_role === "loop");
        setBoundLoopId(projectId, loop?.agent_instance_id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, setBoundLoopId]);

  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) fetchLoopStatus();
    prevConnectedRef.current = connected;
  }, [connected, fetchLoopStatus]);

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (!isForProject(e)) return;
        dispatch({ type: "loopStarted", agentId: e.agent_id });
      }),
      subscribe(EventType.TaskStarted, (e) => {
        if (!isForProject(e)) return;
        dispatch({ type: "taskStarted" });
      }),
      subscribe(EventType.LoopPaused, (e) => {
        if (!isForProject(e)) return;
        dispatch({ type: "loopPaused" });
      }),
      subscribe(EventType.LoopResumed, (e) => {
        if (!isForProject(e)) return;
        dispatch({ type: "loopResumed" });
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (!isForProject(e)) return;
        dispatch({ type: "loopStopped", agentId: e.agent_id });
        // The Loop-role row itself is persistent, so we keep
        // `boundLoopId` populated -- the next Start reuses the same
        // instance. We only clear it when the row is deleted, which
        // happens via `LoopFinished` for terminal lifecycles.
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (!isForProject(e)) return;
        dispatch({ type: "loopFinished", agentId: e.agent_id });
        // Side effect kept verbatim outside the reducer: the
        // insufficient-credits dispatch fans out to the global error
        // banner, which is React-state work the pure reducer must
        // not own.
        if (e.content.outcome === "insufficient_credits") dispatchInsufficientCredits();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, isForProject]);

  const status = statusOf(state);
  const agentCount = agentsOf(state).length;

  const handleStart = useCallback(async () => {
    if (state.kind === "paused") {
      try {
        // Pause/resume always target the bound Loop instance so we
        // never accidentally resume an ephemeral executor or the
        // chat thread the user is currently viewing.
        const res = await api.resumeLoop(projectId, boundLoopId ?? undefined);
        dispatch({
          type: "statusFetched",
          agents: res.active_agent_instances ?? [],
          paused: false,
        });
        hydrateUiFromLoopStartResponse(res, projectId);
        rehydrateLoopActivityForProject(projectId);
      } catch (err) {
        console.error("Failed to resume loop", err);
      }
      return;
    }
    // Optimistically flip into `starting` so the Run button spinner
    // and the sidekick Run/Tasks tab loaders engage immediately on
    // click, and stay engaged without flicker across three phases:
    //   1. request in flight           -> kind: "starting"
    //   2. loop_started WS arrives     -> kind: "preparing"
    //   3. task_started WS arrives     -> kind: "active"
    // Without this the spinner would flash off between the HTTP
    // response and the `loop_started` WS event, making the ramp-up
    // look stalled on the first (or interrupted) task of a fresh run.
    dispatch({ type: "startClicked" });
    try {
      // Omit `agent_instance_id`: the backend resolves to the
      // project's `Loop`-role instance via
      // `ensure_default_loop_instance`, lazily creating one if this
      // is the first Start in the project. Passing the URL's
      // currently-viewed chat agent here would force the loop onto
      // that chat instance and the harness's "one in-flight turn per
      // agent_id" policy would silently abort either the chat reply
      // or the next loop turn -- exactly the regression we're fixing.
      const res = await api.startLoop(projectId, undefined, selectedModel);
      // Capture the Loop instance the backend resolved to so all
      // subsequent pause / resume / stop calls scope themselves to
      // it. `start_loop` populates `agent_instance_id` on the
      // response with the resolved id, regardless of whether we
      // passed one in.
      if (res.agent_instance_id) {
        setBoundLoopId(projectId, res.agent_instance_id);
      }
      // Reconcile the optimistic `starting` state with the server's
      // authoritative agent list so the UI updates immediately, in
      // step with the HTTP response, instead of waiting on the
      // `loop_started` WS event.
      dispatch({
        type: "statusFetched",
        agents: res.active_agent_instances ?? [],
        paused: false,
      });
      // Seed the Run panel row + Tasks list "live" dot from the response
      // so the user sees activity without waiting for task_started.
      hydrateUiFromLoopStartResponse(res, projectId);
      rehydrateLoopActivityForProject(projectId);
    } catch (err) {
      dispatch({ type: "startFailed" });
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Failed to start loop", err);
    }
  }, [projectId, state.kind, selectedModel, boundLoopId, setBoundLoopId]);

  const handlePause = useCallback(async () => {
    try {
      // The server emits `loop_paused` on success; the WS handler
      // dispatches `loopPaused` to drive the UI. We deliberately do
      // NOT optimistically dispatch here: a no-op-on-failure path
      // keeps the bar in `active` if the harness rejects the pause,
      // matching the old code's behaviour (it only cleared
      // `preparing`, never set `paused`).
      await api.pauseLoop(projectId, boundLoopId ?? undefined);
    } catch (err) { console.error("Failed to pause loop", err); }
  }, [projectId, boundLoopId]);

  const handleStop = useCallback(() => {
    setStopError(null);
    setConfirmStop(true);
  }, []);

  const clearStopError = useCallback(() => setStopError(null), []);

  const handleStopConfirm = useCallback(async () => {
    setConfirmStop(false);
    setStopError(null);
    // Optimistically clear UI state so the Run button returns immediately even
    // if the HTTP round-trip is slow or ultimately fails. We reconcile against
    // the authoritative backend state below.
    dispatch({ type: "stopRequested" });
    try {
      // Always scope Stop to the bound Loop instance. A
      // project-wide stop (boundLoopId === null) would also tear
      // down ephemeral task executors running concurrently in the
      // same project -- the regression Phase 2's per-instance
      // registry was built to fix.
      const res = await api.stopLoop(projectId, boundLoopId ?? undefined);
      dispatch({
        type: "statusFetched",
        agents: res.active_agent_instances ?? [],
        paused: Boolean(res.paused),
      });
      fetchLoopStatus();
      // Also rehydrate the unified spinner store so any stale activity
      // row from the loop instance we just stopped is evicted on the
      // same round-trip as the legacy status fetch, instead of waiting
      // for the `loop_ended` WS event to land (which may race a rapid
      // follow-up Start).
      rehydrateLoopActivityForProject(projectId);
    } catch (err) {
      console.error("Failed to stop loop", err);
      setStopError(errorMessage(err, "Failed to stop automation"));
      // If the stop request failed the harness may still be running; refresh
      // from the server so the UI reflects the true state instead of our
      // optimistic clear.
      fetchLoopStatus();
      rehydrateLoopActivityForProject(projectId);
    }
  }, [projectId, boundLoopId, fetchLoopStatus]);

  return {
    status,
    agentCount,
    canPlay: canPlayFn(state),
    canPause: canPauseFn(state),
    canStop: canStopFn(state),
    // Legacy boolean projections retained for callers that haven't
    // migrated to `status` yet (none currently rely on them, but the
    // interface surface stays compatible).
    starting: state.kind === "starting",
    preparing: state.kind === "preparing",
    confirmStop, setConfirmStop,
    handleStart, handlePause, handleStop, handleStopConfirm,
    stopError, clearStopError,
  };
}