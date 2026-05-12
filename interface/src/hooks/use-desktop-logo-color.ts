import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client";
import type { DesktopPreferences } from "../shared/api/desktop";

const STORAGE_KEY = "aura-desktop-preferences";
const LEGACY_COLOR_KEY = "aura-desktop-logo-color";

export type PulseMode = "fade" | "sweep";

interface DesktopPrefs {
  color: string;
  pulseEnabled: boolean;
  pulseMode: PulseMode;
  pulseSpeed: number;
  pulseFromColor: string;
  sweepReversed: boolean;
  pauseDuration: number;
}

const DEFAULTS: DesktopPrefs = {
  color: "",
  pulseEnabled: false,
  pulseMode: "fade",
  pulseSpeed: 2,
  pulseFromColor: "",
  sweepReversed: false,
  pauseDuration: 0,
};

function parseStored(): DesktopPrefs {
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
let _prefs: DesktopPrefs = parseStored();

function getSnapshot(): DesktopPrefs {
  return _prefs;
}

// Singleton <style> element for dynamic pulse keyframes.
// Keyframe percentages depend on speed + pause so they can't be static CSS.
// We inject global (non-hashed) names so inline animation: can reference them.
let _styleEl: HTMLStyleElement | null = null;

function syncPulseStyle(p: DesktopPrefs): void {
  if (typeof document === "undefined") return;
  if (!_styleEl) {
    _styleEl = document.createElement("style");
    _styleEl.dataset.id = "aura-pulse";
    document.head.appendChild(_styleEl);
  }

  if (!p.pulseEnabled) {
    _styleEl.textContent = "";
    return;
  }

  const total = p.pulseSpeed + p.pauseDuration;
  const fi = ((p.pulseSpeed / 2 / total) * 100).toFixed(3);  // fade-in end %
  const pe = (((p.pulseSpeed / 2 + p.pauseDuration) / total) * 100).toFixed(3); // pause end %

  _styleEl.textContent = `
@keyframes aura-logo-fade {
  0%      { background-color: var(--logo-pulse-from, white); }
  ${fi}%  { background-color: var(--logo-pulse-to, white); }
  ${pe}%  { background-color: var(--logo-pulse-to, white); }
  100%    { background-color: var(--logo-pulse-from, white); }
}
@keyframes aura-logo-sweep {
  0%      { clip-path: inset(0 100% 0 0); }
  ${fi}%  { clip-path: inset(0 0% 0 0); }
  ${pe}%  { clip-path: inset(0 0% 0 0); }
  100%    { clip-path: inset(0 0 0 100%); }
}
@keyframes aura-logo-sweep-rev {
  0%      { clip-path: inset(0 100% 0 0); }
  ${fi}%  { clip-path: inset(0 0% 0 0); }
  ${pe}%  { clip-path: inset(0 0% 0 0); }
  100%    { clip-path: inset(0 100% 0 0); }
}`;
}

function writeLocal(next: DesktopPrefs): void {
  _prefs = next;
  syncPulseStyle(next);
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
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", handleStorage);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}

function toApiPrefs(p: DesktopPrefs): DesktopPreferences {
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

function fromApiPrefs(p: DesktopPreferences): DesktopPrefs {
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

function applyPatch(update: Partial<DesktopPrefs>): void {
  const next = { ..._prefs, ...update };
  writeLocal(next);
  notify();
  api.patchDesktopPreferences(toApiPrefs(next)).catch(() => {});
}

// Eagerly initialize the style element on module load so keyframes exist
// before the first render.
if (typeof window !== "undefined") {
  syncPulseStyle(_prefs);
}

export function useDesktopLogoColor() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);

  useEffect(() => {
    syncPulseStyle(_prefs);
    api.getDesktopPreferences().then((remote) => {
      const fromRemote = fromApiPrefs(remote);
      if (JSON.stringify(fromRemote) !== JSON.stringify(_prefs)) {
        writeLocal(fromRemote);
        notify();
      }
    }).catch(() => {});
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
