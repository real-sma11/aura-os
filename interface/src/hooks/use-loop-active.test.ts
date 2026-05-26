import { renderHook, act, waitFor } from "@testing-library/react";
import { useLoopActive } from "./use-loop-active";
import { useAutomationLoopStore } from "../stores/automation-loop-store";
import type { ProjectId } from "../shared/types";

type SubscribeCallback = (event: Record<string, string>) => void;

const subscribeMap = new Map<string, Set<SubscribeCallback>>();

function subscribe(type: string, cb: SubscribeCallback): () => void {
  if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
  subscribeMap.get(type)!.add(cb);
  return () => subscribeMap.get(type)!.delete(cb);
}

vi.mock("../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: typeof subscribe }) => unknown) =>
    selector({ subscribe }),
}));

vi.mock("../api/client", () => ({
  api: {
    getLoopStatus: vi.fn().mockResolvedValue({ active_agent_instances: [] }),
  },
}));

import { api } from "../api/client";

describe("useLoopActive", () => {
  beforeEach(() => {
    subscribeMap.clear();
    useAutomationLoopStore.getState().reset();
    vi.mocked(api.getLoopStatus).mockReset().mockResolvedValue({ active_agent_instances: [] });
  });

  it("returns false initially when no agents are active", async () => {
    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(api.getLoopStatus).toHaveBeenCalled();
    });

    expect(result.current).toBe(false);
  });

  it("returns true when API reports active agents", async () => {
    vi.mocked(api.getLoopStatus).mockResolvedValue({
      active_agent_instances: [{ agent_instance_id: "a1" }],
    });

    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("returns false when projectId is undefined", () => {
    const { result } = renderHook(() => useLoopActive(undefined));
    expect(result.current).toBe(false);
  });

  it("becomes true on loop_started event", async () => {
    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(subscribeMap.has("loop_started")).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) => cb({ project_id: "proj-1" }));
    });

    expect(result.current).toBe(true);
  });

  it("becomes false on loop_stopped event", async () => {
    vi.mocked(api.getLoopStatus).mockResolvedValue({
      active_agent_instances: [{ agent_instance_id: "a1" }],
    });

    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_stopped")!.forEach((cb) => cb({ project_id: "proj-1" }));
    });

    expect(result.current).toBe(false);
  });

  it("ignores events for other projects", async () => {
    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(subscribeMap.has("loop_started")).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) => cb({ project_id: "proj-other" }));
    });

    expect(result.current).toBe(false);
  });

  it("cleans up subscriptions on unmount", async () => {
    const { unmount } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(subscribeMap.has("loop_started")).toBe(true);
    });

    unmount();

    expect(subscribeMap.get("loop_started")!.size).toBe(0);
  });

  // Regression: every forwarder teardown emits `loop_finished` — the
  // bound dev-loop's main automaton AND every ephemeral task-runner
  // automaton spawned by `run_single_task`. Without bound-id scoping,
  // a normal task-completion (`loop_finished` with the ephemeral's
  // agent_id) would mask the still-running dev loop as inactive,
  // causing RunTaskButton's `effectiveStatus` to flip back to
  // "ready" for tasks that are still mid-flight.
  it("ignores loop_finished from ephemeral task-runner agents when the bound Loop is known", async () => {
    vi.mocked(api.getLoopStatus).mockResolvedValue({
      active_agent_instances: [{ agent_instance_id: "loop-agent-1" }],
    });
    useAutomationLoopStore
      .getState()
      .setLoopAgent("proj-1" as ProjectId, "loop-agent-1");

    const { result } = renderHook(() => useLoopActive("proj-1" as ProjectId));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_finished")!.forEach((cb) =>
        cb({ project_id: "proj-1", agent_id: "ephemeral-task-runner-1" }),
      );
    });

    expect(result.current).toBe(true);
  });

  it("flips to false when loop_finished arrives for the bound Loop instance", async () => {
    vi.mocked(api.getLoopStatus).mockResolvedValue({
      active_agent_instances: [{ agent_instance_id: "loop-agent-1" }],
    });
    useAutomationLoopStore
      .getState()
      .setLoopAgent("proj-1" as ProjectId, "loop-agent-1");

    const { result } = renderHook(() => useLoopActive("proj-1" as ProjectId));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_finished")!.forEach((cb) =>
        cb({ project_id: "proj-1", agent_id: "loop-agent-1" }),
      );
    });

    expect(result.current).toBe(false);
  });

  // Before `boundLoopId` has been populated (very first run on a
  // fresh project) we still want terminal events to take effect —
  // otherwise the hook would never flip to false on a project whose
  // Loop row hasn't been hydrated yet.
  it("falls back to project-only filtering when no bound Loop id is set", async () => {
    vi.mocked(api.getLoopStatus).mockResolvedValue({
      active_agent_instances: [{ agent_instance_id: "a1" }],
    });

    const { result } = renderHook(() => useLoopActive("proj-1" as ProjectId));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_finished")!.forEach((cb) =>
        cb({ project_id: "proj-1", agent_id: "whatever-agent-id" }),
      );
    });

    expect(result.current).toBe(false);
  });
});
