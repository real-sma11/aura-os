import { describe, expect, it } from "vitest";
import {
  agentsOf,
  automationReducer,
  canPause,
  canPlay,
  canStop,
  initialState,
  statusOf,
  type AutomationAction,
  type AutomationState,
} from "./automation-state-machine";

/**
 * Run a sequence of actions against `initialState` and return the
 * final state. Mirrors the way the reducer is driven inside
 * `useAutomationStatus` (one action per WS event / one action per
 * HTTP path success).
 */
function run(...actions: AutomationAction[]): AutomationState {
  return actions.reduce(automationReducer, initialState);
}

describe("automation-state-machine: initial state", () => {
  it("starts in idle", () => {
    expect(initialState).toEqual({ kind: "idle" });
    expect(statusOf(initialState)).toBe("idle");
    expect(agentsOf(initialState)).toEqual([]);
    expect(canPlay(initialState)).toBe(true);
    expect(canPause(initialState)).toBe(false);
    expect(canStop(initialState)).toBe(false);
  });
});

describe("automation-state-machine: startClicked", () => {
  it("idle -> starting", () => {
    const s = run({ type: "startClicked" });
    expect(s).toEqual({ kind: "starting" });
  });

  it("paused -> paused (no transition; resume HTTP path drives it)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: true },
      { type: "startClicked" },
    );
    expect(s).toEqual({ kind: "paused", agents: ["a1"] });
  });

  it("active -> starting (cold-start branch from any non-paused state)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: false },
      { type: "startClicked" },
    );
    expect(s).toEqual({ kind: "starting" });
  });
});

describe("automation-state-machine: loopStarted", () => {
  it("idle + agentId -> preparing with that agent", () => {
    const s = run({ type: "loopStarted", agentId: "a1" });
    expect(s).toEqual({ kind: "preparing", agents: ["a1"] });
  });

  it("idle + no agentId -> preparing with empty list", () => {
    const s = run({ type: "loopStarted" });
    expect(s).toEqual({ kind: "preparing", agents: [] });
  });

  it("starting + agentId -> preparing with agent", () => {
    const s = run({ type: "startClicked" }, { type: "loopStarted", agentId: "a1" });
    expect(s).toEqual({ kind: "preparing", agents: ["a1"] });
  });

  it("preparing with existing agent + same agentId -> dedupe (multi-agent edge case)", () => {
    const s = run(
      { type: "loopStarted", agentId: "a1" },
      { type: "loopStarted", agentId: "a1" },
    );
    expect(s).toEqual({ kind: "preparing", agents: ["a1"] });
  });

  it("preparing + new agentId -> agents are merged", () => {
    const s = run(
      { type: "loopStarted", agentId: "a1" },
      { type: "loopStarted", agentId: "a2" },
    );
    expect(s).toEqual({ kind: "preparing", agents: ["a1", "a2"] });
  });

  it("active + new agentId -> preparing with merged agents", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: false },
      { type: "loopStarted", agentId: "a2" },
    );
    expect(s).toEqual({ kind: "preparing", agents: ["a1", "a2"] });
  });
});

describe("automation-state-machine: taskStarted", () => {
  it("preparing with agents -> active (carries agents)", () => {
    const s = run(
      { type: "loopStarted", agentId: "a1" },
      { type: "taskStarted" },
    );
    expect(s).toEqual({ kind: "active", agents: ["a1"] });
  });

  it("preparing with empty agents -> no-op", () => {
    const s = run({ type: "loopStarted" }, { type: "taskStarted" });
    expect(s).toEqual({ kind: "preparing", agents: [] });
  });

  it("idle -> no-op", () => {
    const s = run({ type: "taskStarted" });
    expect(s).toEqual({ kind: "idle" });
  });

  it("starting -> no-op", () => {
    const s = run({ type: "startClicked" }, { type: "taskStarted" });
    expect(s).toEqual({ kind: "starting" });
  });

  it("active -> no-op", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: false },
      { type: "taskStarted" },
    );
    expect(s).toEqual({ kind: "active", agents: ["a1"] });
  });

  it("paused -> no-op", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: true },
      { type: "taskStarted" },
    );
    expect(s).toEqual({ kind: "paused", agents: ["a1"] });
  });
});

describe("automation-state-machine: loopPaused", () => {
  it("active -> paused (carries agents)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1", "a2"], paused: false },
      { type: "loopPaused" },
    );
    expect(s).toEqual({ kind: "paused", agents: ["a1", "a2"] });
  });

  it("preparing -> paused (carries agents from preparing)", () => {
    const s = run(
      { type: "loopStarted", agentId: "a1" },
      { type: "loopPaused" },
    );
    expect(s).toEqual({ kind: "paused", agents: ["a1"] });
  });

  it("idle -> paused with empty agents (matches old setPaused(true) on empty activeAgents)", () => {
    const s = run({ type: "loopPaused" });
    expect(s).toEqual({ kind: "paused", agents: [] });
  });

  it("paused -> paused (idempotent)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: true },
      { type: "loopPaused" },
    );
    expect(s).toEqual({ kind: "paused", agents: ["a1"] });
  });
});

describe("automation-state-machine: loopResumed", () => {
  it("paused -> active (carries agents)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: true },
      { type: "loopResumed" },
    );
    expect(s).toEqual({ kind: "active", agents: ["a1"] });
  });

  it("idle -> idle (no-op)", () => {
    const s = run({ type: "loopResumed" });
    expect(s).toEqual({ kind: "idle" });
  });

  it("active -> active (no-op)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: false },
      { type: "loopResumed" },
    );
    expect(s).toEqual({ kind: "active", agents: ["a1"] });
  });
});

describe("automation-state-machine: loopStopped", () => {
  it("active single-agent + matching agentId -> idle", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: false },
      { type: "loopStopped", agentId: "a1" },
    );
    expect(s).toEqual({ kind: "idle" });
  });

  it("active multi-agent + agentId -> active with remaining", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1", "a2"], paused: false },
      { type: "loopStopped", agentId: "a1" },
    );
    expect(s).toEqual({ kind: "active", agents: ["a2"] });
  });

  it("active + no agentId -> idle (project-wide stop)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1", "a2"], paused: false },
      { type: "loopStopped" },
    );
    expect(s).toEqual({ kind: "idle" });
  });

  it("paused single-agent + matching agentId -> idle (clears paused too)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: true },
      { type: "loopStopped", agentId: "a1" },
    );
    expect(s).toEqual({ kind: "idle" });
  });

  it("idle + any agentId -> idle (no-op)", () => {
    const s = run({ type: "loopStopped", agentId: "a1" });
    expect(s).toEqual({ kind: "idle" });
  });
});

describe("automation-state-machine: loopFinished", () => {
  it("identical UI-shape semantics to loopStopped", () => {
    const a = run(
      { type: "statusFetched", agents: ["a1", "a2"], paused: false },
      { type: "loopFinished", agentId: "a1" },
    );
    expect(a).toEqual({ kind: "active", agents: ["a2"] });

    const b = run(
      { type: "statusFetched", agents: ["a1"], paused: false },
      { type: "loopFinished", agentId: "a1" },
    );
    expect(b).toEqual({ kind: "idle" });

    const c = run(
      { type: "statusFetched", agents: ["a1", "a2"], paused: false },
      { type: "loopFinished" },
    );
    expect(c).toEqual({ kind: "idle" });
  });
});

describe("automation-state-machine: statusFetched", () => {
  it("non-empty agents + paused=false -> active", () => {
    const s = run({ type: "statusFetched", agents: ["a1"], paused: false });
    expect(s).toEqual({ kind: "active", agents: ["a1"] });
  });

  it("non-empty agents + paused=true -> paused", () => {
    const s = run({ type: "statusFetched", agents: ["a1"], paused: true });
    expect(s).toEqual({ kind: "paused", agents: ["a1"] });
  });

  it("empty agents collapses to idle regardless of paused flag", () => {
    expect(run({ type: "statusFetched", agents: [], paused: false })).toEqual({
      kind: "idle",
    });
    expect(run({ type: "statusFetched", agents: [], paused: true })).toEqual({
      kind: "idle",
    });
  });

  it("from starting -> active when response has agents (start-response reconciliation)", () => {
    const s = run(
      { type: "startClicked" },
      { type: "statusFetched", agents: ["a1"], paused: false },
    );
    expect(s).toEqual({ kind: "active", agents: ["a1"] });
  });

  it("from preparing -> overwrites with response agents", () => {
    const s = run(
      { type: "loopStarted", agentId: "a1" },
      { type: "statusFetched", agents: ["a1", "a2"], paused: false },
    );
    expect(s).toEqual({ kind: "active", agents: ["a1", "a2"] });
  });
});

describe("automation-state-machine: stopRequested", () => {
  it("active -> idle (optimistic clear)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: false },
      { type: "stopRequested" },
    );
    expect(s).toEqual({ kind: "idle" });
  });

  it("paused -> idle", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: true },
      { type: "stopRequested" },
    );
    expect(s).toEqual({ kind: "idle" });
  });

  it("idle -> idle", () => {
    const s = run({ type: "stopRequested" });
    expect(s).toEqual({ kind: "idle" });
  });
});

describe("automation-state-machine: startFailed", () => {
  it("starting -> idle", () => {
    const s = run({ type: "startClicked" }, { type: "startFailed" });
    expect(s).toEqual({ kind: "idle" });
  });

  it("preparing -> preparing (no-op; WS already advanced past starting)", () => {
    const s = run(
      { type: "startClicked" },
      { type: "loopStarted", agentId: "a1" },
      { type: "startFailed" },
    );
    expect(s).toEqual({ kind: "preparing", agents: ["a1"] });
  });

  it("active -> active (no-op)", () => {
    const s = run(
      { type: "statusFetched", agents: ["a1"], paused: false },
      { type: "startFailed" },
    );
    expect(s).toEqual({ kind: "active", agents: ["a1"] });
  });
});

describe("automation-state-machine: derivations", () => {
  it("canPlay only on idle / paused", () => {
    expect(canPlay({ kind: "idle" })).toBe(true);
    expect(canPlay({ kind: "paused", agents: ["a1"] })).toBe(true);
    expect(canPlay({ kind: "starting" })).toBe(false);
    expect(canPlay({ kind: "preparing", agents: ["a1"] })).toBe(false);
    expect(canPlay({ kind: "active", agents: ["a1"] })).toBe(false);
  });

  it("canPause only on active", () => {
    expect(canPause({ kind: "idle" })).toBe(false);
    expect(canPause({ kind: "starting" })).toBe(false);
    expect(canPause({ kind: "preparing", agents: ["a1"] })).toBe(false);
    expect(canPause({ kind: "active", agents: ["a1"] })).toBe(true);
    expect(canPause({ kind: "paused", agents: ["a1"] })).toBe(false);
  });

  it("canStop on active / paused", () => {
    expect(canStop({ kind: "idle" })).toBe(false);
    expect(canStop({ kind: "starting" })).toBe(false);
    expect(canStop({ kind: "preparing", agents: ["a1"] })).toBe(false);
    expect(canStop({ kind: "active", agents: ["a1"] })).toBe(true);
    expect(canStop({ kind: "paused", agents: ["a1"] })).toBe(true);
  });

  it("agentsOf returns the carried list or [] for kinds without agents", () => {
    expect(agentsOf({ kind: "idle" })).toEqual([]);
    expect(agentsOf({ kind: "starting" })).toEqual([]);
    expect(agentsOf({ kind: "preparing", agents: ["a1"] })).toEqual(["a1"]);
    expect(agentsOf({ kind: "active", agents: ["a1", "a2"] })).toEqual(["a1", "a2"]);
    expect(agentsOf({ kind: "paused", agents: ["a1"] })).toEqual(["a1"]);
  });

  it("statusOf is exactly state.kind", () => {
    expect(statusOf({ kind: "idle" })).toBe("idle");
    expect(statusOf({ kind: "starting" })).toBe("starting");
    expect(statusOf({ kind: "preparing", agents: [] })).toBe("preparing");
    expect(statusOf({ kind: "active", agents: ["a1"] })).toBe("active");
    expect(statusOf({ kind: "paused", agents: ["a1"] })).toBe("paused");
  });
});

describe("automation-state-machine: full happy-path sequence", () => {
  it("idle -> starting -> preparing -> active -> paused -> active -> idle", () => {
    let s: AutomationState = initialState;
    s = automationReducer(s, { type: "startClicked" });
    expect(s.kind).toBe("starting");
    s = automationReducer(s, { type: "loopStarted", agentId: "loop-1" });
    expect(s.kind).toBe("preparing");
    s = automationReducer(s, { type: "taskStarted" });
    expect(s).toEqual({ kind: "active", agents: ["loop-1"] });
    s = automationReducer(s, { type: "loopPaused" });
    expect(s).toEqual({ kind: "paused", agents: ["loop-1"] });
    s = automationReducer(s, { type: "loopResumed" });
    expect(s).toEqual({ kind: "active", agents: ["loop-1"] });
    s = automationReducer(s, { type: "loopStopped", agentId: "loop-1" });
    expect(s).toEqual({ kind: "idle" });
  });
});