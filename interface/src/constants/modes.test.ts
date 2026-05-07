import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPersistedAgentMode, persistAgentMode } from "./modes";

describe("mode persistence", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const key of Object.keys(store)) delete store[key];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists mode globally when an agent id is supplied", () => {
    persistAgentMode("image", "agent-a");

    expect(store["aura-selected-mode:default"]).toBe("image");
    expect(store["aura-selected-mode:agent:agent-a"]).toBeUndefined();
  });

  it("restores the same mode across agents", () => {
    persistAgentMode("3d", "agent-a");

    expect(loadPersistedAgentMode("agent-b")).toBe("3d");
  });

  it("ignores stale agent-scoped mode keys", () => {
    store["aura-selected-mode:default"] = "plan";
    store["aura-selected-mode:agent:agent-a"] = "image";

    expect(loadPersistedAgentMode("agent-a")).toBe("plan");
  });
});
