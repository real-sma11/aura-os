import { describe, expect, it, beforeEach } from "vitest";

import {
  selectActiveTaskIdsForProject,
  useLoopActivityStore,
  type LoopRow,
} from "./loop-activity-store";
import type {
  LoopActivityPayload,
  LoopIdPayload,
} from "../shared/types/aura-events";

/**
 * These tests pin down the contract that "is this task being worked
 * on right now" is computed from a single source of truth — the
 * `useLoopActivityStore` — and not from a parallel cache. Every
 * scenario starts by writing into the loop-activity store and asserts
 * the derivation responds correctly, mirroring the behaviour the
 * `useLiveTaskIdsForProject` React hook surfaces to consumers.
 */

const baseActivity = (overrides: Partial<LoopActivityPayload>): LoopActivityPayload => ({
  loop_id: "loop-id",
  status: "running",
  current_task_id: null,
  current_step: null,
  percent: null,
  started_at: new Date().toISOString(),
  last_event_at: new Date().toISOString(),
  ...overrides,
});

const baseLoopId = (overrides: Partial<LoopIdPayload>): LoopIdPayload => ({
  project_id: "project-a",
  agent_instance_id: "agent-instance",
  agent_id: "agent",
  instance: "loop-instance",
  ...overrides,
});

const row = (overrides: {
  instance?: string;
  projectId?: string | null;
  status?: LoopActivityPayload["status"];
  currentTaskId?: string | null;
}): LoopRow => ({
  loopId: baseLoopId({
    instance: overrides.instance ?? "loop-instance",
    project_id: overrides.projectId ?? null,
  }),
  activity: baseActivity({
    status: overrides.status ?? "running",
    current_task_id: overrides.currentTaskId ?? null,
  }),
});

describe("selectActiveTaskIdsForProject", () => {
  beforeEach(() => {
    useLoopActivityStore.getState().replaceSnapshot([]);
  });

  it("includes current_task_id from running loops", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "running", currentTaskId: "t1" }),
    ]);
    const ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(Array.from(ids)).toEqual(["t1"]);
  });

  it("excludes paused loops even if current_task_id is still set", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "paused", currentTaskId: "t1" }),
    ]);
    const ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(Array.from(ids)).toEqual([]);
  });

  it("excludes completed loops", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "completed", currentTaskId: "t1" }),
    ]);
    const ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(Array.from(ids)).toEqual([]);
  });

  it("scopes by project_id when provided", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "running", currentTaskId: "t1" }),
      row({ instance: "l2", projectId: "other", status: "running", currentTaskId: "t2" }),
    ]);
    const ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(Array.from(ids)).toEqual(["t1"]);
  });

  it("returns all active across projects when projectId is null", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "running", currentTaskId: "t1" }),
      row({ instance: "l2", projectId: "other", status: "running", currentTaskId: "t2" }),
    ]);
    const ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), null);
    expect(new Set(ids)).toEqual(new Set(["t1", "t2"]));
  });

  it("clears the entry when current_task_id flips to null", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "running", currentTaskId: "t1" }),
    ]);
    let ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(Array.from(ids)).toEqual(["t1"]);

    useLoopActivityStore.getState().upsert(
      baseLoopId({ instance: "l1", project_id: "p" }),
      baseActivity({ status: "running", current_task_id: null }),
    );
    ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(Array.from(ids)).toEqual([]);
  });

  it("clears the entry when the loop is removed (LoopEnded)", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "running", currentTaskId: "t1" }),
    ]);
    useLoopActivityStore.getState().remove("l1");
    const ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(Array.from(ids)).toEqual([]);
  });

  it("merges current_task_id across multiple concurrent loops in the same project", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "running", currentTaskId: "t1" }),
      row({ instance: "l2", projectId: "p", status: "starting", currentTaskId: "t2" }),
    ]);
    const ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(new Set(ids)).toEqual(new Set(["t1", "t2"]));
  });

  it("treats stalled loops as still active (UI keeps spinner muted, not hollow)", () => {
    useLoopActivityStore.getState().replaceSnapshot([
      row({ instance: "l1", projectId: "p", status: "stalled", currentTaskId: "t1" }),
    ]);
    const ids = selectActiveTaskIdsForProject(useLoopActivityStore.getState(), "p");
    expect(Array.from(ids)).toEqual(["t1"]);
  });
});
