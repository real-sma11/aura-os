export const DEFAULT_SIDEKICK_WIDTH = 320;
export const SIDEKICK_MIN_WIDTH = 200;
export const SIDEKICK_MAX_WIDTH = 1200;

/**
 * Single shared storage key for the sidekick width. The sidekick lane is the
 * same width across every app and never changes when switching apps, so all
 * apps read from and write to this one key.
 */
export const SIDEKICK_STORAGE_KEY = "aura-sidekick-width";

// Legacy keys kept only for one-time read-through migration so existing users
// keep whatever width they had configured before the shared-width change.
const LEGACY_SHARED_KEY = "aura-sidekick-v2";
const LEGACY_PROJECTS_KEY = "aura-projects-sidekick-v1";
const LEGACY_PER_APP_PREFIX = "aura-sidekick-width:";
// Preferred order for picking which per-app value to inherit when nothing else
// is set. Anything not in this list is considered last (in storage order).
const LEGACY_PER_APP_PREFERENCE = ["projects", "tasks", "agents"];

function clampSidekickWidth(width: number) {
  return Math.min(SIDEKICK_MAX_WIDTH, Math.max(SIDEKICK_MIN_WIDTH, width));
}

function parseStoredWidth(rawValue: string | null): number | null {
  if (rawValue == null) return null;
  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue)) return null;
  return clampSidekickWidth(parsedValue);
}

function readLegacyPerAppWidth(): number | null {
  let preferredValue: number | null = null;
  let preferredRank = Number.POSITIVE_INFINITY;
  let fallbackValue: number | null = null;

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LEGACY_PER_APP_PREFIX)) continue;
    const value = parseStoredWidth(localStorage.getItem(key));
    if (value == null) continue;
    const appId = key.slice(LEGACY_PER_APP_PREFIX.length);
    const rank = LEGACY_PER_APP_PREFERENCE.indexOf(appId);
    if (rank !== -1 && rank < preferredRank) {
      preferredRank = rank;
      preferredValue = value;
    } else if (fallbackValue == null) {
      fallbackValue = value;
    }
  }

  return preferredValue ?? fallbackValue;
}

/**
 * Read the persisted sidekick width. The same value is used for every app.
 *
 * Migration order (only used when the shared key is unset):
 *   1. New shared key (`aura-sidekick-width`).
 *   2. Legacy shared key (`aura-sidekick-v2`).
 *   3. Any `aura-sidekick-width:<appId>` per-app entry, preferring projects,
 *      then tasks, then agents, then any other.
 *   4. `DEFAULT_SIDEKICK_WIDTH`.
 *
 * When a legacy value is used it is also written through to the new shared key
 * so subsequent reads short-circuit on step 1.
 */
export function readStoredSidekickWidth(): number {
  if (typeof window === "undefined") return DEFAULT_SIDEKICK_WIDTH;
  try {
    const current = parseStoredWidth(localStorage.getItem(SIDEKICK_STORAGE_KEY));
    if (current != null) return current;

    const legacyShared = parseStoredWidth(localStorage.getItem(LEGACY_SHARED_KEY));
    if (legacyShared != null) {
      localStorage.setItem(SIDEKICK_STORAGE_KEY, String(legacyShared));
      return legacyShared;
    }

    const legacyProjects = parseStoredWidth(localStorage.getItem(LEGACY_PROJECTS_KEY));
    if (legacyProjects != null) {
      localStorage.setItem(SIDEKICK_STORAGE_KEY, String(legacyProjects));
      return legacyProjects;
    }

    const inheritedPerApp = readLegacyPerAppWidth();
    if (inheritedPerApp != null) {
      localStorage.setItem(SIDEKICK_STORAGE_KEY, String(inheritedPerApp));
      return inheritedPerApp;
    }

    return DEFAULT_SIDEKICK_WIDTH;
  } catch {
    return DEFAULT_SIDEKICK_WIDTH;
  }
}

export function persistSidekickWidth(width: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SIDEKICK_STORAGE_KEY, String(clampSidekickWidth(width)));
  } catch {
    // Ignore storage failures.
  }
}
