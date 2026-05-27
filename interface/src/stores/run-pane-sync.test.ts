import { describe, it, expect, beforeEach } from "vitest";

import { hydrateActiveTasksFromLoopStatus } from "./run-pane-sync";
import { useTaskOutputPanelStore } from "./task-output-panel-store";

beforeEach(() => {
  useTaskOutputPanelStore.setState({ tasks: [] });
});

describe("hydrateActiveTasksFromLoopStatus", () => {
  it("does not demote WS-seeded rows during automation ramp-up (loop live, active_tasks empty)", () => {
    useTaskOutputPanelStore.getState().addTask("ws-task", "p1", "From WS");

    hydrateActiveTasksFromLoopStatus(
      {
        running: true,
        paused: false,
        project_id: "p1",
        active_agent_instances: ["loop-agent"],
        active_tasks: [],
      },
      "p1",
    );

    const row = useTaskOutputPanelStore.getState().tasks.find((t) => t.taskId === "ws-task");
    expect(row?.status).toBe("active");
  });

  it("demotes stale rows when the loop is idle and active_tasks is empty", () => {
    useTaskOutputPanelStore.getState().addTask("stale", "p1", "Old run");

    hydrateActiveTasksFromLoopStatus(
      {
        running: false,
        paused: false,
        project_id: "p1",
        active_agent_instances: [],
        active_tasks: [],
      },
      "p1",
    );

    const row = useTaskOutputPanelStore.getState().tasks.find((t) => t.taskId === "stale");
    expect(row?.status).toBe("interrupted");
  });

  it("promotes server-reported active tasks", () => {
    hydrateActiveTasksFromLoopStatus(
      {
        running: true,
        paused: false,
        project_id: "p1",
        active_agent_instances: ["loop-agent"],
        active_tasks: [{ task_id: "server-task", agent_instance_id: "loop-agent" }],
      },
      "p1",
    );

    const row = useTaskOutputPanelStore.getState().tasks.find((t) => t.taskId === "server-task");
    expect(row?.status).toBe("active");
    expect(row?.agentInstanceId).toBe("loop-agent");
  });
});
