import { beforeEach, describe, expect, it } from "vitest";
import { useLoopActivityStore } from "./loop-activity-store";
import type {
  LoopActivityPayload,
  LoopIdPayload,
} from "../shared/types/aura-events";

function loopRow(
  loopId: Partial<LoopIdPayload> & Pick<LoopIdPayload, "instance" | "project_id">,
  activity: Partial<LoopActivityPayload> = {},
) {
  return {
    loopId: {
      user_id: "u",
      project_id: loopId.project_id,
      agent_instance_id: loopId.agent_instance_id,
      agent_id: loopId.agent_id ?? "agent",
      kind: loopId.kind ?? "automation",
      instance: loopId.instance,
    } as LoopIdPayload,
    activity: {
      status: activity.status ?? "active",
      percent: activity.percent ?? 0,
      current_step: activity.current_step ?? null,
      current_task_id: activity.current_task_id ?? null,
      last_event_at: activity.last_event_at ?? new Date().toISOString(),
    } as LoopActivityPayload,
  };
}

beforeEach(() => {
  useLoopActivityStore.setState({ loops: {}, hydrated: false });
});

describe("loop-activity-store", () => {
  describe("replaceSnapshot (project-scoped)", () => {
    it("with no filter, replaces the entire loops map (legacy behaviour)", () => {
      // The boot / WS-reconnect rehydrate path passes no filter and
      // expects `replaceSnapshot` to be a clean full-state overwrite
      // — the server's `/api/loops` returns the authoritative set
      // across every loop the user can see.
      const store = useLoopActivityStore.getState();
      store.upsert(loopRow({ instance: "i-1", project_id: "p1" }).loopId, loopRow({ instance: "i-1", project_id: "p1" }).activity);
      store.upsert(loopRow({ instance: "i-2", project_id: "p2" }).loopId, loopRow({ instance: "i-2", project_id: "p2" }).activity);

      const next = [loopRow({ instance: "i-3", project_id: "p1" })];
      useLoopActivityStore.getState().replaceSnapshot(next);

      const loops = useLoopActivityStore.getState().loops;
      expect(Object.keys(loops).sort()).toEqual(["i-3"]);
    });

    it("with a project_id filter, preserves rows for other projects", () => {
      // Regression: `useAutomationStatus` calls `hydrate({ project_id })`
      // on every Start / Stop click as a safety net against the
      // rapid Stop+Start WS race. Without the merge-by-filter
      // semantics, that scoped hydrate would wipe the activity row
      // for an in-flight loop in a different project just because
      // it didn't appear in the per-project response.
      const store = useLoopActivityStore.getState();
      store.upsert(loopRow({ instance: "p1-loop-old", project_id: "p1" }).loopId, loopRow({ instance: "p1-loop-old", project_id: "p1" }).activity);
      store.upsert(loopRow({ instance: "p2-loop-untouched", project_id: "p2" }).loopId, loopRow({ instance: "p2-loop-untouched", project_id: "p2" }).activity);

      const fresh = [loopRow({ instance: "p1-loop-new", project_id: "p1" })];
      useLoopActivityStore.getState().replaceSnapshot(fresh, { project_id: "p1" });

      const loops = useLoopActivityStore.getState().loops;
      expect(Object.keys(loops).sort()).toEqual([
        "p1-loop-new",
        "p2-loop-untouched",
      ]);
      // The p1 row from before was evicted (its project matched the
      // filter and it was absent from the fresh response).
      expect(loops["p1-loop-old"]).toBeUndefined();
    });

    it("with an empty {} filter, falls back to full-replace semantics", () => {
      // `hydrate({})` callers (any future caller that forgets to
      // narrow) must NOT silently retain stale rows just because
      // the filter object exists. The guard checks every filter
      // axis individually.
      const store = useLoopActivityStore.getState();
      store.upsert(loopRow({ instance: "i-1", project_id: "p1" }).loopId, loopRow({ instance: "i-1", project_id: "p1" }).activity);

      useLoopActivityStore.getState().replaceSnapshot([], {});

      const loops = useLoopActivityStore.getState().loops;
      expect(loops).toEqual({});
    });

    it("scoped hydrate flips the hydrated flag", () => {
      useLoopActivityStore.getState().replaceSnapshot([], { project_id: "p1" });
      expect(useLoopActivityStore.getState().hydrated).toBe(true);
    });
  });
});
