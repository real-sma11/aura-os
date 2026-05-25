/**
 * Discriminated-union state machine for the AutomationBar.
 *
 * Replaces the four implicit-coupled `useState` cells (`activeAgents`,
 * `paused`, `starting`, `preparing`) that previously lived in
 * `useAutomationStatus`. Each WS event dispatches exactly one
 * `AutomationAction`; status, agentCount, and the canPlay/canPause/canStop
 * button gates are pure derivations of `AutomationState`.
 *
 * The reducer is pure (no React imports) so it is unit-testable without
 * a renderer. See `automation-state-machine.test.ts`.
 */

/**
 * The possible UI states of the AutomationBar. Each variant is a single
 * source of truth: there is no way to be both `starting` and `paused`,
 * which the old four-boolean shape allowed.
 *
 * Note on `preparing`: the gap between the user clicking Play and the
 * first `task_started` arriving on the WS is not "active" yet -- there
 * is a `loop_started` event but no work has begun. Surfacing it as a
 * distinct kind keeps the `LoopProgress` ring spinning without flicker
 * across the three sub-phases (`starting` -> `preparing` -> `active`).
 */
export type AutomationState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "preparing"; agents: string[] }
  | { kind: "active"; agents: string[] }
  | { kind: "paused"; agents: string[] };

/**
 * Status string surfaced to consumers (StatusBadge, AutomationBar, the
 * `useAutomationStatus` return shape). The reducer never emits
 * `"stopped"` -- it is retained in the union so existing literal
 * comparisons in `AutomationBar.tsx` (`status !== "stopped"`) continue
 * to type-check without modification.
 */
export type AutomationStatus =
  | "idle"
  | "starting"
  | "preparing"
  | "active"
  | "paused"
  | "stopped";

/**
 * Single dispatch surface. Each WS subscription handler in
 * `useAutomationStatus` becomes one `dispatch({ type: ... })` call;
 * each HTTP path that previously called multiple setters becomes one
 * dispatch (or two, in the optimistic-clear-then-reconcile case for
 * `handleStopConfirm`).
 */
export type AutomationAction =
  | { type: "startClicked" }
  | { type: "loopStarted"; agentId?: string }
  | { type: "taskStarted" }
  | { type: "loopPaused" }
  | { type: "loopResumed" }
  | { type: "loopStopped"; agentId?: string }
  | { type: "loopFinished"; agentId?: string }
  | { type: "statusFetched"; agents: string[]; paused: boolean }
  | { type: "stopRequested" }
  | { type: "startFailed" };

export const initialState: AutomationState = { kind: "idle" };

/**
 * Read agents off any state variant. `idle` and `starting` carry no
 * agents -- everything else has the array.
 */
function agents(state: AutomationState): string[] {
  return state.kind === "preparing" || state.kind === "active" || state.kind === "paused"
    ? state.agents
    : [];
}

/**
 * Merge an `agentId` into an existing list without duplicating. The
 * old code's WS handler did the same dedupe in
 * `setActiveAgents((prev) => prev.includes(id) ? prev : [...prev, id])`;
 * preserving it here keeps the multi-agent edge case stable across
 * Stage 5.
 */
function mergeAgent(prev: string[], agentId: string | undefined): string[] {
  if (!agentId) return prev;
  return prev.includes(agentId) ? prev : [...prev, agentId];
}

/**
 * Filter a single `agentId` out of the list. If `agentId` is omitted
 * the entire list is cleared, mirroring the old behavior where
 * `LoopStopped` / `LoopFinished` events without an `agent_id`
 * indicated a project-wide stop.
 */
function filterAgent(prev: string[], agentId: string | undefined): string[] {
  if (!agentId) return [];
  return prev.filter((id) => id !== agentId);
}

export function automationReducer(
  state: AutomationState,
  action: AutomationAction,
): AutomationState {
  switch (action.type) {
    case "startClicked": {
      // From `paused` we keep waiting for `loopResumed` (the resume
      // HTTP path drives that); only the cold-start branches collapse
      // to `starting`.
      if (state.kind === "paused") return state;
      return { kind: "starting" };
    }

    case "loopStarted": {
      // Merge the new agent_id into whichever list the prior state
      // carried (empty for idle/starting). Always lands in
      // `preparing`: a `task_started` arrives next to promote to
      // `active`.
      const next = mergeAgent(agents(state), action.agentId);
      return { kind: "preparing", agents: next };
    }

    case "taskStarted": {
      // Promote `preparing` -> `active` if we have agents to display.
      // From any other state this is a no-op: the old code only
      // flipped `setPreparing(false)`, which had no visible effect
      // outside the preparing window.
      if (state.kind === "preparing" && state.agents.length > 0) {
        return { kind: "active", agents: state.agents };
      }
      return state;
    }

    case "loopPaused": {
      // Carry whatever agents the prior state had. From idle (no
      // agents) we still transition to paused with an empty list --
      // matches the old `setPaused(true)` writing into a state where
      // `activeAgents` was already `[]`.
      return { kind: "paused", agents: agents(state) };
    }

    case "loopResumed": {
      // Only meaningful from `paused`. The WS event arrives after the
      // server has accepted the resume, so the agents list is still
      // valid.
      if (state.kind === "paused") {
        return { kind: "active", agents: state.agents };
      }
      return state;
    }

    case "loopStopped":
    case "loopFinished": {
      // Both events have identical UI-shape semantics. The
      // `insufficient_credits` side effect is NOT handled here -- the
      // React subscription handler calls `dispatchInsufficientCredits()`
      // alongside the dispatch.
      const remaining = filterAgent(agents(state), action.agentId);
      if (remaining.length === 0) return { kind: "idle" };
      return { kind: "active", agents: remaining };
    }

    case "statusFetched": {
      // HTTP poll / start-response reconciliation. Empty agents
      // collapses to idle regardless of `paused`, mirroring the old
      // `else` branch that cleared everything.
      if (action.agents.length === 0) return { kind: "idle" };
      if (action.paused) return { kind: "paused", agents: action.agents };
      return { kind: "active", agents: action.agents };
    }

    case "stopRequested": {
      // Optimistic clear before the stop HTTP round-trip; reconciled
      // by a subsequent `statusFetched` dispatch on success or
      // failure.
      return { kind: "idle" };
    }

    case "startFailed": {
      // Only meaningful from `starting`. Other states (race against
      // an early WS event) keep their post-WS state.
      if (state.kind === "starting") return { kind: "idle" };
      return state;
    }
  }
}

export const canPlay = (s: AutomationState): boolean =>
  s.kind === "idle" || s.kind === "paused";

export const canPause = (s: AutomationState): boolean => s.kind === "active";

export const canStop = (s: AutomationState): boolean =>
  s.kind === "active" || s.kind === "paused";

export const agentsOf = (s: AutomationState): string[] => agents(s);

/**
 * Derive the legacy-shaped `AutomationStatus` string from a state.
 * Kept narrow (no `"stopped"` ever emitted) to match the old
 * imperative status ladder at lines 226-230 of the pre-refactor
 * `useAutomationStatus.ts`.
 */
export const statusOf = (s: AutomationState): AutomationStatus => s.kind;