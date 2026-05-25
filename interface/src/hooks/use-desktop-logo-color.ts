import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client";
import { useAuthStore } from "../stores/auth-store";
import type { DesktopPrefs } from "../shared/api/preferences";
import { syncPulseKeyframes } from "./logo-pulse-keyframes";

const STORAGE_KEY = "aura-desktop-preferences";
const LEGACY_COLOR_KEY = "aura-desktop-logo-color";

/**
 * Dispatched after the post-login server-hydration step writes a fresher
 * payload into localStorage. Mounted hooks listen for it so they pick up
 * the new value without remounting.
 */
const HYDRATED_EVENT = "aura-desktop-prefs-hydrated";

export type PulseMode = "fade" | "sweep";

interface DesktopPrefsLocal {
  color: string;
  pulseEnabled: boolean;
  pulseMode: PulseMode;
  pulseSpeed: number;
  pulseFromColor: string;
  sweepReversed: boolean;
  pauseDuration: number;
}

const DEFAULTS: DesktopPrefsLocal = {
  color: "",
  pulseEnabled: false,
  pulseMode: "fade",
  pulseSpeed: 2,
  pulseFromColor: "",
  sweepReversed: false,
  pauseDuration: 0,
};

function parseStored(): DesktopPrefsLocal {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    const legacy = localStorage.getItem(LEGACY_COLOR_KEY);
    if (legacy) return { ...DEFAULTS, color: legacy };
  } catch {}
  return DEFAULTS;
}

// Module-level stable reference — useSyncExternalStore requires the same
// object reference to be returned when the data hasn't changed.
let _prefs: DesktopPrefsLocal = parseStored();

function getSnapshot(): DesktopPrefsLocal {
  return _prefs;
}

function writeLocal(next: DesktopPrefsLocal): void {
  _prefs = next;
  syncPulseKeyframes(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      try {
        _prefs = e.newValue ? { ...DEFAULTS, ...JSON.parse(e.newValue) } : DEFAULTS;
      } catch {
        _prefs = DEFAULTS;
      }
      cb();
    }
  };
  const handleHydrated = () => {
    _prefs = parseStored();
    cb();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(HYDRATED_EVENT, handleHydrated);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(HYDRATED_EVENT, handleHydrated);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}

function toApiPrefs(p: DesktopPrefsLocal): DesktopPrefs {
  return {
    logo_color: p.color || null,
    pulse_enabled: p.pulseEnabled,
    pulse_mode: p.pulseMode,
    pulse_speed: p.pulseSpeed,
    pulse_from_color: p.pulseFromColor || null,
    sweep_reversed: p.sweepReversed,
    pulse_pause: p.pauseDuration,
  };
}

function fromApiPrefs(p: DesktopPrefs): DesktopPrefsLocal {
  return {
    color: p.logo_color ?? "",
    pulseEnabled: p.pulse_enabled ?? false,
    pulseMode: p.pulse_mode ?? "fade",
    pulseSpeed: p.pulse_speed ?? 2,
    pulseFromColor: p.pulse_from_color ?? "",
    sweepReversed: p.sweep_reversed ?? false,
    pauseDuration: p.pulse_pause ?? 0,
  };
}

/** Fire-and-forget PUT — UI already updated locally; failure is logged
 *  by the network layer and the next change re-pushes the full blob. */
function pushToServer(next: DesktopPrefsLocal): void {
  void api.preferences.putDesktop(toApiPrefs(next)).catch(() => {});
}

/** Write-through helper: localStorage first (cheap, sync, sets up the
 *  next page load), then server PUT (cross-install survivability). */
function persistStore(next: DesktopPrefsLocal): void {
  writeLocal(next);
  notify();
  pushToServer(next);
}

function applyPatch(update: Partial<DesktopPrefsLocal>): void {
  persistStore({ ..._prefs, ...update });
}

// "Meaningful data" guard — a fresh-install server response is every
// field null/false-by-default and should NOT clobber a richer local
// working set the user may have built up offline before the server got
// any data.
function hasContent(remote: DesktopPrefs): boolean {
  return (
    remote.logo_color !== null ||
    remote.pulse_enabled !== null ||
    remote.pulse_mode !== null ||
    remote.pulse_speed !== null ||
    remote.pulse_from_color !== null ||
    remote.sweep_reversed !== null ||
    remote.pulse_pause !== null
  );
}

let _hydrationUserId: string | null = null;

async function hydrateFromServer(): Promise<void> {
  let server: DesktopPrefs;
  try {
    server = await api.preferences.getDesktop();
  } catch {
    return;
  }
  if (!hasContent(server)) return;
  writeLocal(fromApiPrefs(server));
  notify();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(HYDRATED_EVENT));
  }
}

// Module-level subscription: server-hydrate desktop prefs once the user
// is identified, then again whenever the user identity changes. The
// `DesktopTitlebar` (which calls `useDesktopLogoColor` for its side
// effects) ensures this module is loaded at app boot on desktop.
useAuthStore.subscribe((state) => {
  const userId = state.user?.user_id ?? null;
  if (userId === _hydrationUserId) return;
  _hydrationUserId = userId;
  if (!userId) return;
  void hydrateFromServer();
});

// Eagerly initialize the style element on module load so keyframes exist
// before the first render.
if (typeof window !== "undefined") {
  syncPulseKeyframes(_prefs);
}

export function useDesktopLogoColor() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);

  useEffect(() => {
    syncPulseKeyframes(_prefs);
  }, []);

  const setColor = useCallback((next: string | undefined) => {
    applyPatch({ color: next ?? "" });
  }, []);

  const setPulseEnabled = useCallback((next: boolean) => {
    applyPatch({ pulseEnabled: next });
  }, []);

  const setPulseMode = useCallback((next: PulseMode) => {
    applyPatch({ pulseMode: next });
  }, []);

  const setPulseSpeed = useCallback((next: number) => {
    applyPatch({ pulseSpeed: next });
  }, []);

  const setPulseFromColor = useCallback((next: string | undefined) => {
    applyPatch({ pulseFromColor: next ?? "" });
  }, []);

  const setSweepReversed = useCallback((next: boolean) => {
    applyPatch({ sweepReversed: next });
  }, []);

  const setPauseDuration = useCallback((next: number) => {
    applyPatch({ pauseDuration: next });
  }, []);

  return {
    color: prefs.color,
    pulseEnabled: prefs.pulseEnabled,
    pulseMode: prefs.pulseMode,
    pulseSpeed: prefs.pulseSpeed,
    pulseFromColor: prefs.pulseFromColor,
    sweepReversed: prefs.sweepReversed,
    pauseDuration: prefs.pauseDuration,
    setColor,
    setPulseEnabled,
    setPulseMode,
    setPulseSpeed,
    setPulseFromColor,
    setSweepReversed,
    setPauseDuration,
  };
}
