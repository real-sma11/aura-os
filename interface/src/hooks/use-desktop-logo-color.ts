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

function readLocal(): DesktopPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    // Migrate legacy single-color key
    const legacy = localStorage.getItem(LEGACY_COLOR_KEY);
    if (legacy) return { ...DEFAULTS, color: legacy };
    return DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function writeLocal(prefs: DesktopPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
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

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const handleStorage = () => cb();
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", handleStorage);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}

function patch(update: Partial<DesktopPrefs>): void {
  const next = { ...readLocal(), ...update };
  writeLocal(next);
  notify();
  api.patchDesktopPreferences(toApiPrefs(next)).catch(() => {});
}

export function useDesktopLogoColor() {
  const prefs = useSyncExternalStore(subscribe, readLocal, () => DEFAULTS);

  useEffect(() => {
    api.getDesktopPreferences().then((remote) => {
      const local = readLocal();
      const fromRemote = fromApiPrefs(remote);
      // Only sync if remote differs — remote is authoritative after reinstall
      if (JSON.stringify(fromRemote) !== JSON.stringify(local)) {
        writeLocal(fromRemote);
        notify();
      }
    }).catch(() => {});
  }, []);

  const setColor = useCallback((next: string | undefined) => {
    patch({ color: next ?? "" });
  }, []);

  const setPulseEnabled = useCallback((next: boolean) => {
    patch({ pulseEnabled: next });
  }, []);

  const setPulseMode = useCallback((next: PulseMode) => {
    patch({ pulseMode: next });
  }, []);

  const setPulseSpeed = useCallback((next: number) => {
    patch({ pulseSpeed: next });
  }, []);

  const setPulseFromColor = useCallback((next: string | undefined) => {
    patch({ pulseFromColor: next ?? "" });
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
