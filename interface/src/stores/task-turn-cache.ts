import type { DisplaySessionEvent } from "../shared/types/stream";
import {
  BROWSER_DB_STORES,
  browserDbDelete,
  browserDbGet,
  browserDbSet,
} from "../shared/lib/browser-db";

/* ------------------------------------------------------------------ */
/*  Task turn cache                                                    */
/*                                                                     */
/*  Persists the structured turn history (events[] with timeline,      */
/*  toolCalls and thinking text) for a finalized task so the Run       */
/*  panel and sidekick overlay can rehydrate a rich post-completion    */
/*  view even after the in-memory stream store has been pruned or the  */
/*  page has been reloaded.                                            */
/*                                                                     */
/*  This is complementary to `task-output-cache.ts` which stores only  */
/*  the concatenated TextDelta text. Both are read by the unified      */
/*  `useTaskOutputView` hook so consumers do not have to chase         */
/*  fallback chains manually.                                          */
/* ------------------------------------------------------------------ */

interface PersistedTaskTurns {
  taskId: string;
  projectId?: string;
  events: DisplaySessionEvent[];
  updatedAt: number;
}

/**
 * Legacy localStorage key. Read once during {@link hydrateFromStorage}
 * for the one-time migration on first hydration after deploy, then
 * removed.
 */
const TASK_TURN_CACHE_LEGACY_KEY = "aura-task-turns-v1";
const TASK_TURN_CACHE_IDB_KEY = "entries";
const TASK_TURN_CACHE_MAX_ENTRIES = 60;
const TASK_TURN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Per-entry cap to keep cache entries sane. The assistant turn
// events can include very large tool results (e.g. read_file dumps)
// so we truncate anything we cannot serialize within the budget.
const TASK_TURN_MAX_SERIALIZED_BYTES = 256 * 1024;

let taskTurnCache: PersistedTaskTurns[] | null = null;
let hydratePromise: Promise<void> | null = null;
let legacyMigrationRan = false;

function canUseLocalStorage(): boolean {
  try {
    return (
      typeof globalThis !== "undefined" &&
      !!(globalThis as unknown as { localStorage?: Storage }).localStorage
    );
  } catch {
    return false;
  }
}

function readLegacyEntries(): PersistedTaskTurns[] {
  if (!canUseLocalStorage()) return [];
  try {
    const storage = (globalThis as unknown as { localStorage: Storage }).localStorage;
    const raw = storage.getItem(TASK_TURN_CACHE_LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedTaskTurns[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function removeLegacyEntries(): void {
  if (!canUseLocalStorage()) return;
  try {
    const storage = (globalThis as unknown as { localStorage: Storage }).localStorage;
    storage.removeItem(TASK_TURN_CACHE_LEGACY_KEY);
  } catch {
    // ignore
  }
}

function entriesAreValid(entries: PersistedTaskTurns[]): PersistedTaskTurns[] {
  const now = Date.now();
  return entries.filter(
    (entry) =>
      !!entry?.taskId &&
      Array.isArray(entry.events) &&
      typeof entry.updatedAt === "number" &&
      now - entry.updatedAt <= TASK_TURN_CACHE_TTL_MS,
  );
}

function trimEntries(entries: PersistedTaskTurns[]): PersistedTaskTurns[] {
  return entriesAreValid(entries)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-TASK_TURN_CACHE_MAX_ENTRIES);
}

function dedupeEntries(entries: PersistedTaskTurns[]): PersistedTaskTurns[] {
  const byKey = new Map<string, PersistedTaskTurns>();
  for (const entry of entries) {
    const key = `${entry.taskId}::${entry.projectId ?? ""}`;
    const existing = byKey.get(key);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      byKey.set(key, entry);
    }
  }
  return Array.from(byKey.values());
}

async function hydrateFromStorage(): Promise<void> {
  let fromIdb: PersistedTaskTurns[] = [];
  try {
    const raw = await browserDbGet<PersistedTaskTurns[]>(
      BROWSER_DB_STORES.taskTurns,
      TASK_TURN_CACHE_IDB_KEY,
    );
    if (Array.isArray(raw)) fromIdb = raw;
  } catch {
    // ignore — fall through to legacy / empty
  }

  let merged = fromIdb;
  let migrated = false;
  if (!legacyMigrationRan) {
    legacyMigrationRan = true;
    const legacy = readLegacyEntries();
    if (legacy.length > 0) {
      merged = dedupeEntries([...fromIdb, ...legacy]);
      migrated = true;
    }
  }

  taskTurnCache = trimEntries(merged);

  if (migrated) {
    try {
      await browserDbSet(
        BROWSER_DB_STORES.taskTurns,
        TASK_TURN_CACHE_IDB_KEY,
        taskTurnCache,
      );
    } catch {
      // ignore — next persist will pick the merged set up
    }
    removeLegacyEntries();
  }
}

/**
 * Resolves when the in-memory cache has been populated from IDB (and
 * any legacy localStorage migration has completed). Consumers that
 * need a deterministic hydration point should `await` it; the public
 * read API also awaits this internally.
 */
export const whenCacheReady: Promise<void> = (() => {
  hydratePromise = hydrateFromStorage();
  return hydratePromise;
})();

function ensureCache(): PersistedTaskTurns[] {
  if (!taskTurnCache) taskTurnCache = [];
  return taskTurnCache;
}

function persistCacheToIdb(entries: PersistedTaskTurns[]): void {
  const trimmed = trimEntries(entries);
  taskTurnCache = trimmed;
  // Fire-and-forget: the in-memory mirror is the source of truth
  // during the session; IDB writes resolve in the background.
  void browserDbSet(
    BROWSER_DB_STORES.taskTurns,
    TASK_TURN_CACHE_IDB_KEY,
    trimmed,
  ).catch(() => {
    // ignore — IDB write errors are non-fatal
  });
}

/**
 * Serialize events down to a size that fits the cache without
 * corrupting downstream renderers. We strip image data (which is the
 * most common cause of bloat) and truncate oversized tool results,
 * preserving enough context that `MessageBubble` / `LLMOutput` still
 * render the structure.
 */
function compactEvents(events: DisplaySessionEvent[]): DisplaySessionEvent[] {
  const truncate = (s: string, n: number): string =>
    s.length > n ? `${s.slice(0, n)}\n… [truncated for cache]` : s;

  let compact = events.map((evt) => ({
    ...evt,
    contentBlocks: evt.contentBlocks?.filter((b) => b.type !== "image"),
    toolCalls: evt.toolCalls?.map((tc) => ({
      ...tc,
      result: tc.result ? truncate(tc.result, 8 * 1024) : tc.result,
    })),
  }));

  // If we are still over budget, drop the oldest events first.
  while (
    compact.length > 1 &&
    JSON.stringify(compact).length > TASK_TURN_MAX_SERIALIZED_BYTES
  ) {
    compact = compact.slice(1);
  }
  return compact;
}

export function persistTaskTurns(
  taskId: string,
  events: DisplaySessionEvent[],
  projectId?: string,
): void {
  if (!taskId || !events || events.length === 0) return;
  const compact = compactEvents(events);
  const cache = ensureCache();
  const next: PersistedTaskTurns = {
    taskId,
    projectId,
    events: compact,
    updatedAt: Date.now(),
  };
  const idx = cache.findIndex(
    (entry) => entry.taskId === taskId && entry.projectId === projectId,
  );
  if (idx >= 0) {
    cache[idx] = next;
  } else {
    cache.push(next);
  }
  persistCacheToIdb(cache);
}

export async function readTaskTurns(
  taskId: string,
  projectId?: string,
): Promise<DisplaySessionEvent[]> {
  if (!taskId) return [];
  await whenCacheReady;
  const cache = ensureCache();
  const exact = cache.find(
    (entry) => entry.taskId === taskId && entry.projectId === projectId,
  );
  if (exact?.events?.length) return exact.events;
  const fallback = cache.find((entry) => entry.taskId === taskId);
  return fallback?.events ?? [];
}

export function invalidateTaskTurns(taskId: string): void {
  if (!taskId) return;
  const cache = ensureCache();
  const next = cache.filter((entry) => entry.taskId !== taskId);
  if (next.length !== cache.length) persistCacheToIdb(next);
}

/** Test-only: clear the entire cache between tests. */
export function resetTaskTurnCache(): void {
  taskTurnCache = [];
  void browserDbDelete(
    BROWSER_DB_STORES.taskTurns,
    TASK_TURN_CACHE_IDB_KEY,
  ).catch(() => {
    // ignore
  });
}
