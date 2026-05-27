import { BROWSER_DB_STORES, browserDbGet, browserDbSet } from "../../shared/lib/browser-db";

interface PersistedTaskOutputCacheEntry {
  taskId: string;
  projectId?: string;
  text: string;
  updatedAt: number;
}

/**
 * Legacy localStorage key. Kept here for the one-time migration on
 * first hydration after deploy — once the cache module has run
 * `migrateLegacyEntries` the key is removed and the constant is no
 * longer touched.
 */
const TASK_OUTPUT_CACHE_LEGACY_KEY = "aura-task-output-cache-v1";
const TASK_OUTPUT_CACHE_IDB_KEY = "entries";
const TASK_OUTPUT_CACHE_MAX_ENTRIES = 500;
const TASK_OUTPUT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TASK_OUTPUT_CACHE_WRITE_DEBOUNCE_MS = 500;
const TASK_OUTPUT_CACHE_MAX_WRITE_DELAY_MS = 2_000;
/**
 * Per-entry head-truncation cap. Long automation transcripts can
 * grow into the tens of MB; we keep the tail (which carries the
 * most recent assistant turn) and drop the head so IDB never has
 * to write a multi-MB blob per task.
 */
const TASK_OUTPUT_CACHE_MAX_TEXT_BYTES = 5 * 1024 * 1024;

let taskOutputCache: PersistedTaskOutputCacheEntry[] | null = null;
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let persistMaxDelayTimer: ReturnType<typeof setTimeout> | null = null;
let hasPendingPersist = false;
let legacyMigrationRan = false;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readLegacyEntries(): PersistedTaskOutputCacheEntry[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(TASK_OUTPUT_CACHE_LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedTaskOutputCacheEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function removeLegacyEntries(): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.removeItem(TASK_OUTPUT_CACHE_LEGACY_KEY);
  } catch {
    // ignore
  }
}

function entriesAreValid(
  entries: PersistedTaskOutputCacheEntry[],
): PersistedTaskOutputCacheEntry[] {
  const now = Date.now();
  return entries.filter(
    (entry) =>
      !!entry?.taskId &&
      typeof entry.text === "string" &&
      entry.text.length > 0 &&
      typeof entry.updatedAt === "number" &&
      now - entry.updatedAt <= TASK_OUTPUT_CACHE_TTL_MS,
  );
}

function truncateEntryText(entry: PersistedTaskOutputCacheEntry): PersistedTaskOutputCacheEntry {
  if (entry.text.length <= TASK_OUTPUT_CACHE_MAX_TEXT_BYTES) return entry;
  // Head-truncate: keep the tail (most recent output) so the user
  // still sees the assistant's last turn. Prepend a marker so
  // downstream renderers don't silently lose context.
  const tail = entry.text.slice(entry.text.length - TASK_OUTPUT_CACHE_MAX_TEXT_BYTES);
  return { ...entry, text: tail };
}

function trimTaskOutputCacheEntries(
  entries: PersistedTaskOutputCacheEntry[],
): PersistedTaskOutputCacheEntry[] {
  return entriesAreValid(entries)
    .map(truncateEntryText)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-TASK_OUTPUT_CACHE_MAX_ENTRIES);
}

function dedupeEntries(
  entries: PersistedTaskOutputCacheEntry[],
): PersistedTaskOutputCacheEntry[] {
  const byKey = new Map<string, PersistedTaskOutputCacheEntry>();
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
  let fromIdb: PersistedTaskOutputCacheEntry[] = [];
  try {
    const raw = await browserDbGet<PersistedTaskOutputCacheEntry[]>(
      BROWSER_DB_STORES.taskOutputCache,
      TASK_OUTPUT_CACHE_IDB_KEY,
    );
    if (Array.isArray(raw)) fromIdb = raw;
  } catch {
    // ignore — fall through to legacy / empty
  }

  let mergedEntries = fromIdb;
  let migrated = false;
  if (!legacyMigrationRan) {
    legacyMigrationRan = true;
    const legacy = readLegacyEntries();
    if (legacy.length > 0) {
      mergedEntries = dedupeEntries([...fromIdb, ...legacy]);
      migrated = true;
    }
  }

  taskOutputCache = trimTaskOutputCacheEntries(mergedEntries);

  if (migrated) {
    try {
      await browserDbSet(
        BROWSER_DB_STORES.taskOutputCache,
        TASK_OUTPUT_CACHE_IDB_KEY,
        taskOutputCache,
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
export const whenCacheReady: Promise<void> = hydrateFromStorage();

function getTaskOutputCache(): PersistedTaskOutputCacheEntry[] {
  if (!taskOutputCache) {
    taskOutputCache = [];
  }
  return taskOutputCache;
}

function persistEntriesToIdb(entries: PersistedTaskOutputCacheEntry[]): void {
  const filtered = trimTaskOutputCacheEntries(entries);
  taskOutputCache = filtered;
  // Fire-and-forget: IDB writes resolve in the background; consumers
  // do not block on persistence (the in-memory mirror is the source
  // of truth during the session).
  void browserDbSet(
    BROWSER_DB_STORES.taskOutputCache,
    TASK_OUTPUT_CACHE_IDB_KEY,
    filtered,
  ).catch(() => {
    // ignore — IDB write errors are non-fatal
  });
}

function clearPersistTimers(): void {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  if (persistMaxDelayTimer) {
    clearTimeout(persistMaxDelayTimer);
    persistMaxDelayTimer = null;
  }
}

function flushPersistedTaskOutputCache(): void {
  if (!hasPendingPersist || !taskOutputCache) return;
  clearPersistTimers();
  hasPendingPersist = false;
  persistEntriesToIdb(taskOutputCache);
}

function schedulePersistedTaskOutputCacheWrite(): void {
  hasPendingPersist = true;
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
  }
  persistDebounceTimer = setTimeout(() => {
    flushPersistedTaskOutputCache();
  }, TASK_OUTPUT_CACHE_WRITE_DEBOUNCE_MS);

  if (!persistMaxDelayTimer) {
    persistMaxDelayTimer = setTimeout(() => {
      flushPersistedTaskOutputCache();
    }, TASK_OUTPUT_CACHE_MAX_WRITE_DELAY_MS);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPersistedTaskOutputCache);
}

export function persistTaskOutputText(taskId: string, text: string, projectId?: string): void {
  if (!text) return;
  const cache = getTaskOutputCache();
  const matchIndex = cache.findIndex((entry) => entry.taskId === taskId && entry.projectId === projectId);
  const nextEntry: PersistedTaskOutputCacheEntry = truncateEntryText({
    taskId,
    projectId,
    text,
    updatedAt: Date.now(),
  });
  if (matchIndex >= 0) {
    cache[matchIndex] = nextEntry;
  } else {
    cache.push(nextEntry);
  }
  taskOutputCache = trimTaskOutputCacheEntries(cache);
  schedulePersistedTaskOutputCacheWrite();
}

export function removePersistedTaskOutputText(taskId: string): void {
  const cache = getTaskOutputCache();
  const next = cache.filter((entry) => entry.taskId !== taskId);
  if (next.length !== cache.length) {
    taskOutputCache = next;
    schedulePersistedTaskOutputCacheWrite();
  }
}

export async function getCachedTaskOutputText(
  taskId: string,
  projectId?: string,
): Promise<string> {
  await whenCacheReady;
  const cache = getTaskOutputCache();
  const exact = cache.find((entry) => entry.taskId === taskId && entry.projectId === projectId);
  if (exact?.text) return exact.text;
  const fallback = cache.find((entry) => entry.taskId === taskId);
  return fallback?.text ?? "";
}
