import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client";

const STORAGE_KEY = "aura-desktop-logo-color";

function read(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLocal(next: string | undefined): void {
  try {
    if (next) {
      localStorage.setItem(STORAGE_KEY, next);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
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

export function useDesktopLogoColor() {
  const color = useSyncExternalStore(subscribe, read, () => "");

  // On mount, pull the authoritative value from the native store and sync
  // it into localStorage so the next render (and other tabs) see it.
  useEffect(() => {
    api.getDesktopPreferences().then((prefs) => {
      const remote = prefs.logo_color ?? "";
      if (remote !== read()) {
        writeLocal(remote || undefined);
        notify();
      }
    }).catch(() => {});
  }, []);

  const setColor = useCallback((next: string | undefined) => {
    // Update localStorage immediately — the title bar repaints this frame.
    writeLocal(next);
    notify();
    // Persist to the native store in the background.
    api.patchDesktopPreferences({ logo_color: next ?? null }).catch(() => {});
  }, []);

  return { color, setColor };
}
