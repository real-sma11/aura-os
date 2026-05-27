import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Back the IDB stores with an in-memory Map so the cache module can
// hydrate and persist without a real IndexedDB. Each test resets the
// map (and the module graph) for isolation. Mirrors the pattern used
// by the chat-history tests (NotesNav.test.tsx / NotesMainPanel.test.tsx).
const idbStorage = new Map<string, unknown>();
vi.mock("../../shared/lib/browser-db", () => ({
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

const TASK_OUTPUT_CACHE_LEGACY_KEY = "aura-task-output-cache-v1";
const TASK_OUTPUT_IDB_FULL_KEY = "taskOutputCache::entries";

async function loadCacheModule() {
  return import("./task-output-cache");
}

async function flushMicrotasks() {
  // The hydration path resolves through a few awaited microtasks.
  // Running real timers a couple of times lets the queue drain even
  // while fake timers are installed in some tests.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  idbStorage.clear();
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("task-output-cache", () => {
  it("serves fresh output from memory before the debounced IDB write", async () => {
    const mod = await loadCacheModule();
    await mod.whenCacheReady;

    mod.persistTaskOutputText("task-1", "hello", "project-1");

    await expect(mod.getCachedTaskOutputText("task-1", "project-1")).resolves.toBe(
      "hello",
    );
    expect(idbStorage.has(TASK_OUTPUT_IDB_FULL_KEY)).toBe(false);

    vi.advanceTimersByTime(500);
    await flushMicrotasks();

    const persisted = idbStorage.get(TASK_OUTPUT_IDB_FULL_KEY) as Array<{
      text: string;
    }>;
    expect(persisted?.[0]?.text).toBe("hello");
  });

  it("coalesces rapid output updates into one persisted write", async () => {
    const mod = await loadCacheModule();
    await mod.whenCacheReady;

    mod.persistTaskOutputText("task-1", "a", "project-1");
    vi.advanceTimersByTime(250);
    mod.persistTaskOutputText("task-1", "ab", "project-1");
    vi.advanceTimersByTime(250);
    mod.persistTaskOutputText("task-1", "abc", "project-1");

    expect(idbStorage.has(TASK_OUTPUT_IDB_FULL_KEY)).toBe(false);
    vi.advanceTimersByTime(500);
    await flushMicrotasks();

    const persisted = idbStorage.get(TASK_OUTPUT_IDB_FULL_KEY) as Array<{
      taskId: string;
      projectId?: string;
      text: string;
    }>;
    expect(persisted).toMatchObject([
      { taskId: "task-1", projectId: "project-1", text: "abc" },
    ]);
  });

  it("flushes no later than the max write delay during continuous updates", async () => {
    const mod = await loadCacheModule();
    await mod.whenCacheReady;

    mod.persistTaskOutputText("task-1", "a", "project-1");
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(400);
      mod.persistTaskOutputText("task-1", `a${i}`, "project-1");
    }

    expect(idbStorage.has(TASK_OUTPUT_IDB_FULL_KEY)).toBe(false);
    vi.advanceTimersByTime(400);
    await flushMicrotasks();

    expect(idbStorage.has(TASK_OUTPUT_IDB_FULL_KEY)).toBe(true);
  });

  it("flushes synchronously before unload", async () => {
    const mod = await loadCacheModule();
    await mod.whenCacheReady;

    mod.persistTaskOutputText("task-1", "hello", "project-1");
    window.dispatchEvent(new Event("beforeunload"));
    await flushMicrotasks();

    const persisted = idbStorage.get(TASK_OUTPUT_IDB_FULL_KEY) as Array<{
      text: string;
    }>;
    expect(persisted?.[0]?.text).toBe("hello");
  });

  it("removes entries from the in-memory cache immediately", async () => {
    const mod = await loadCacheModule();
    await mod.whenCacheReady;

    mod.persistTaskOutputText("task-1", "hello", "project-1");
    mod.removePersistedTaskOutputText("task-1");

    await expect(mod.getCachedTaskOutputText("task-1", "project-1")).resolves.toBe(
      "",
    );
    vi.advanceTimersByTime(500);
    await flushMicrotasks();

    const persisted = idbStorage.get(TASK_OUTPUT_IDB_FULL_KEY) as Array<unknown>;
    expect(persisted).toEqual([]);
  });

  it("migrates legacy localStorage entries on first hydration and removes the legacy key", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      TASK_OUTPUT_CACHE_LEGACY_KEY,
      JSON.stringify([
        {
          taskId: "legacy-1",
          projectId: "project-1",
          text: "legacy text",
          updatedAt: now,
        },
      ]),
    );

    const mod = await loadCacheModule();
    await mod.whenCacheReady;

    await expect(mod.getCachedTaskOutputText("legacy-1", "project-1")).resolves.toBe(
      "legacy text",
    );
    expect(window.localStorage.getItem(TASK_OUTPUT_CACHE_LEGACY_KEY)).toBeNull();
    // The migrated entries should be written into IDB during hydration
    // so a subsequent reload picks them up without re-reading
    // localStorage.
    const persisted = idbStorage.get(TASK_OUTPUT_IDB_FULL_KEY) as Array<{
      taskId: string;
      text: string;
    }>;
    expect(persisted?.[0]?.taskId).toBe("legacy-1");
    expect(persisted?.[0]?.text).toBe("legacy text");
  });

  it("head-truncates oversized entries to at most ~5 MB and preserves the tail", async () => {
    const mod = await loadCacheModule();
    await mod.whenCacheReady;

    const tailMarker = "TAIL-MARKER";
    const tenMb = 10 * 1024 * 1024;
    const huge = "x".repeat(tenMb - tailMarker.length) + tailMarker;
    mod.persistTaskOutputText("task-huge", huge, "project-1");

    const got = await mod.getCachedTaskOutputText("task-huge", "project-1");
    expect(got.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(got.endsWith(tailMarker)).toBe(true);
  });
});
