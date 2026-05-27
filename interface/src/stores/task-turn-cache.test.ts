import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  const stub = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: stub,
    });
  }
});

// Back the IDB stores with an in-memory Map shared across the test
// file. Each test resets it (and the module graph via
// `vi.resetModules()`) so module-local one-shot migration flags do
// not bleed across tests.
const idbStorage = new Map<string, unknown>();
vi.mock("../shared/lib/browser-db", () => ({
  BROWSER_DB_STORES: new Proxy({}, { get: (_t, prop) => String(prop) }),
  browserDbGet: vi.fn(async (store: string, key: string) =>
    idbStorage.get(`${store}::${key}`) ?? null,
  ),
  browserDbSet: vi.fn(async (store: string, key: string, value: unknown) => {
    idbStorage.set(`${store}::${key}`, value);
  }),
  browserDbDelete: vi.fn(async (store: string, key: string) => {
    idbStorage.delete(`${store}::${key}`);
  }),
}));

import type { DisplaySessionEvent } from "../shared/types/stream";

const TASK_TURN_CACHE_LEGACY_KEY = "aura-task-turns-v1";
const TASK_TURNS_IDB_FULL_KEY = "taskTurns::entries";

async function loadModule() {
  return import("./task-turn-cache");
}

function makeEvent(id: string, text: string): DisplaySessionEvent {
  return {
    id,
    role: "assistant",
    content: text,
    timeline: [{ kind: "text", id: `${id}:text`, content: text }],
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  idbStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("task-turn-cache", () => {
  it("persists and reads structured events for a task", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;

    const events = [makeEvent("e1", "Hello"), makeEvent("e2", "World")];
    mod.persistTaskTurns("task-1", events, "proj-1");
    await flushMicrotasks();

    const read = await mod.readTaskTurns("task-1", "proj-1");
    expect(read).toHaveLength(2);
    expect(read[0].id).toBe("e1");
    expect(read[1].content).toBe("World");
    expect(read[0].timeline?.[0]).toMatchObject({ kind: "text", content: "Hello" });
  });

  it("falls back to taskId-only match when projectId does not match", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;

    mod.persistTaskTurns("task-1", [makeEvent("e1", "A")], "proj-1");
    const read = await mod.readTaskTurns("task-1", "proj-other");
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe("e1");
  });

  it("returns an empty array for unknown tasks", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;
    await expect(mod.readTaskTurns("never-saved")).resolves.toEqual([]);
  });

  it("overwrites prior entries for the same task+project", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;

    mod.persistTaskTurns("task-1", [makeEvent("e1", "old")], "proj-1");
    mod.persistTaskTurns("task-1", [makeEvent("e2", "new")], "proj-1");
    const read = await mod.readTaskTurns("task-1", "proj-1");
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe("e2");
  });

  it("invalidateTaskTurns drops every entry for a task", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;

    mod.persistTaskTurns("task-1", [makeEvent("e1", "a")], "proj-1");
    mod.persistTaskTurns("task-2", [makeEvent("e2", "b")], "proj-2");
    mod.invalidateTaskTurns("task-1");
    await expect(mod.readTaskTurns("task-1")).resolves.toEqual([]);
    await expect(mod.readTaskTurns("task-2", "proj-2")).resolves.toHaveLength(1);
  });

  it("strips image content blocks to keep cache entries compact", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;

    const heavy: DisplaySessionEvent = {
      id: "e1",
      role: "assistant",
      content: "img",
      contentBlocks: [
        { type: "text", text: "keep" },
        { type: "image", media_type: "image/png", data: "BIGBASE64".repeat(10_000) },
      ],
    };
    mod.persistTaskTurns("task-1", [heavy]);
    const read = await mod.readTaskTurns("task-1");
    expect(read[0].contentBlocks).toEqual([{ type: "text", text: "keep" }]);
  });

  it("truncates oversized tool-call results", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;

    const event: DisplaySessionEvent = {
      id: "e1",
      role: "assistant",
      content: "tool",
      toolCalls: [
        {
          id: "tc1",
          name: "read_file",
          input: {},
          pending: false,
          result: "X".repeat(50_000),
        },
      ],
    };
    mod.persistTaskTurns("task-1", [event]);
    const read = await mod.readTaskTurns("task-1");
    const result = read[0].toolCalls?.[0].result ?? "";
    expect(result.length).toBeLessThan(10_000);
    expect(result).toContain("[truncated for cache]");
  });

  it("ignores empty event arrays", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;

    mod.persistTaskTurns("task-1", []);
    await expect(mod.readTaskTurns("task-1")).resolves.toEqual([]);
  });

  it("migrates legacy localStorage entries on first hydration and removes the legacy key", async () => {
    const now = Date.now();
    localStorage.setItem(
      TASK_TURN_CACHE_LEGACY_KEY,
      JSON.stringify([
        {
          taskId: "legacy-1",
          projectId: "proj-1",
          events: [makeEvent("legacy-evt", "from legacy")],
          updatedAt: now,
        },
      ]),
    );

    const mod = await loadModule();
    await mod.whenCacheReady;

    const read = await mod.readTaskTurns("legacy-1", "proj-1");
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe("legacy-evt");
    expect(localStorage.getItem(TASK_TURN_CACHE_LEGACY_KEY)).toBeNull();
    // The migration writes through into IDB so future reads skip
    // localStorage entirely.
    const persisted = idbStorage.get(TASK_TURNS_IDB_FULL_KEY) as Array<{
      taskId: string;
    }>;
    expect(persisted?.some((e) => e.taskId === "legacy-1")).toBe(true);
  });

  it("readTaskTurns returns a Promise that resolves to a DisplaySessionEvent array", async () => {
    const mod = await loadModule();
    await mod.whenCacheReady;

    const result = mod.readTaskTurns("absent-task");
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual([]);
  });
});
