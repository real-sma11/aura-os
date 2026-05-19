import { describe, expect, it } from "vitest";
import type { Task, TaskStatus } from "../types";
import { getTaskDisplayStatus } from "./task-display-status";

function task(status: TaskStatus, taskId = "task-1"): Task {
  return {
    task_id: taskId,
    project_id: "p-1",
    spec_id: "s-1",
    title: "T",
    description: "",
    status,
    order_index: 0,
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: null,
    completed_by_agent_instance_id: null,
    session_id: null,
    execution_notes: "",
    files_changed: [],
    live_output: "",
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: "",
    updated_at: "",
  };
}

describe("getTaskDisplayStatus", () => {
  it("upgrades ready -> in_progress when liveTaskIds has the task", () => {
    const t = task("ready");
    const live = new Set([t.task_id]);
    expect(getTaskDisplayStatus(t, live, true)).toBe("in_progress");
  });

  it("upgrades pending -> in_progress when live", () => {
    const t = task("pending");
    expect(getTaskDisplayStatus(t, new Set([t.task_id]), true)).toBe("in_progress");
  });

  it("does not override done even if mistakenly live", () => {
    const t = task("done");
    expect(getTaskDisplayStatus(t, new Set([t.task_id]), true)).toBe("done");
  });

  it("does not override failed", () => {
    const t = task("failed");
    expect(getTaskDisplayStatus(t, new Set([t.task_id]), true)).toBe("failed");
  });

  it("downgrades in_progress -> ready when not live and other tasks are live", () => {
    const t = task("in_progress");
    const live = new Set(["other-task"]);
    expect(getTaskDisplayStatus(t, live, true)).toBe("ready");
  });

  it("downgrades in_progress -> ready when loop is not active", () => {
    const t = task("in_progress");
    expect(getTaskDisplayStatus(t, new Set(), false)).toBe("ready");
  });

  it("preserves in_progress when loop is active and live set is empty (hydration lag)", () => {
    const t = task("in_progress");
    expect(getTaskDisplayStatus(t, new Set(), true)).toBe("in_progress");
  });

  it("preserves in_progress when this task IS live", () => {
    const t = task("in_progress");
    expect(getTaskDisplayStatus(t, new Set([t.task_id]), true)).toBe("in_progress");
  });

  it("passes through ready when not live", () => {
    const t = task("ready");
    expect(getTaskDisplayStatus(t, new Set(), false)).toBe("ready");
  });
});
