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
}

const DEFAULTS: DesktopPrefs = {
  color: "",
  pulseEnabled: false,
  pulseMode: "fade",
  pulseSpeed: 2,
  pulseFromColor: "",
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

function writeLocal(next: DesktopPrefs): void {
  _prefs = next;
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
  };
}

function fromApiPrefs(p: DesktopPreferences): DesktopPrefs {
  return {
    color: p.logo_color ?? "",
    pulseEnabled: p.pulse_enabled ?? false,
    pulseMode: p.pulse_mode ?? "fade",
    pulseSpeed: p.pulse_speed ?? 2,
    pulseFromColor: p.pulse_from_color ?? "",
  };
}

function applyPatch(update: Partial<DesktopPrefs>): void {
  const next = { ..._prefs, ...update };
  writeLocal(next);
  notify();
  api.patchDesktopPreferences(toApiPrefs(next)).catch(() => {});
}

export function useDesktopLogoColor() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);

  useEffect(() => {
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

  return {
    color: prefs.color,
    pulseEnabled: prefs.pulseEnabled,
    pulseMode: prefs.pulseMode,
    pulseSpeed: prefs.pulseSpeed,
    pulseFromColor: prefs.pulseFromColor,
    setColor,
    setPulseEnabled,
    setPulseMode,
    setPulseSpeed,
    setPulseFromColor,
  };
}
