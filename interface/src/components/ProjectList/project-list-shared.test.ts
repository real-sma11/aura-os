import { describe, expect, it } from "vitest";

import type { AgentInstance } from "../../shared/types";
import { emptyAgentPermissions } from "../../shared/types/permissions-wire";
import {
  getPreferredProjectAgent,
  isUserFacingAgentInstance,
} from "./project-list-shared";

function makeAgent(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    agent_instance_id: "ai-1",
    project_id: "p-1",
    agent_id: "agent-1",
    org_id: "org-1",
    name: "Agent Alpha",
    role: "dev",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    workspace_path: null,
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    permissions: emptyAgentPermissions(),
    intent_classifier: null,
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

describe("isUserFacingAgentInstance", () => {
  it("treats Chat-role rows as user-facing", () => {
    expect(isUserFacingAgentInstance(makeAgent({ instance_role: "chat" }))).toBe(
      true,
    );
  });

  it("treats missing instance_role as Chat for backward compatibility", () => {
    expect(
      isUserFacingAgentInstance(makeAgent({ instance_role: undefined })),
    ).toBe(true);
  });

  it("hides Loop-role rows", () => {
    expect(isUserFacingAgentInstance(makeAgent({ instance_role: "loop" }))).toBe(
      false,
    );
  });

  it("hides Executor-role rows so run-once tasks do not stack duplicates", () => {
    expect(
      isUserFacingAgentInstance(makeAgent({ instance_role: "executor" })),
    ).toBe(false);
  });

  it("treats a missing source as legacy data and keeps the row visible", () => {
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "chat", source: undefined }),
      ),
    ).toBe(true);
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "chat", source: null }),
      ),
    ).toBe(true);
  });

  it("keeps explicit UI-sourced Chat rows visible", () => {
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "chat", source: "ui" }),
      ),
    ).toBe(true);
  });

  it("hides SDK / benchmark / e2e rows so dev runs do not pollute the sidebar", () => {
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "chat", source: "sdk" }),
      ),
    ).toBe(false);
  });

  it("hides server-side auto-home Home-project bindings", () => {
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "chat", source: "auto_home" }),
      ),
    ).toBe(false);
  });

  it("hides new-project Standard-Agent auto-attach rows", () => {
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "chat", source: "auto_project_default" }),
      ),
    ).toBe(false);
  });

  it("hides system-stamped rows even if storage strips instance_role", () => {
    // Defense-in-depth: the Rust `AgentInstanceService` helpers
    // stamp `source = "system"` on every Loop / Executor row so
    // role-defaulted Chat rows (storage 404 / missing column) still
    // get filtered out and don't stack as duplicate sidebar entries.
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: undefined, source: "system" }),
      ),
    ).toBe(false);
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "executor", source: "system" }),
      ),
    ).toBe(false);
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "loop", source: "system" }),
      ),
    ).toBe(false);
  });

  it("hides unknown non-UI sources (forward-compat guard)", () => {
    expect(
      isUserFacingAgentInstance(
        makeAgent({ instance_role: "chat", source: "future_origin" }),
      ),
    ).toBe(false);
  });
});

describe("getPreferredProjectAgent", () => {
  it("skips ephemeral Executor rows when picking the default agent", () => {
    const chat = makeAgent({
      agent_instance_id: "ai-chat",
      instance_role: "chat",
    });
    const executor = makeAgent({
      agent_instance_id: "ai-exec",
      instance_role: "executor",
    });

    expect(getPreferredProjectAgent([executor, chat])).toBe(chat);
  });

  it("returns undefined when only infrastructure rows exist", () => {
    const loop = makeAgent({ instance_role: "loop" });
    const executor = makeAgent({ instance_role: "executor" });

    expect(getPreferredProjectAgent([loop, executor])).toBeUndefined();
  });

  it("ignores a remembered last-agent id pointing at an Executor row", () => {
    const chat = makeAgent({
      agent_instance_id: "ai-chat",
      instance_role: "chat",
    });
    const executor = makeAgent({
      agent_instance_id: "ai-exec",
      instance_role: "executor",
    });

    expect(getPreferredProjectAgent([chat, executor], "ai-exec")).toBe(chat);
  });

  it("still skips archived rows", () => {
    const archived = makeAgent({
      agent_instance_id: "ai-archived",
      status: "archived",
      instance_role: "chat",
    });
    const chat = makeAgent({
      agent_instance_id: "ai-chat",
      instance_role: "chat",
    });

    expect(getPreferredProjectAgent([archived, chat])).toBe(chat);
  });
});
