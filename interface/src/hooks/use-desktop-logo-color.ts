import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "aura-desktop-logo-color";

function read(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
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

  const setColor = useCallback((next: string | undefined) => {
    try {
      if (next) {
        localStorage.setItem(STORAGE_KEY, next);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable
    }
    notify();
  }, []);

  return { color, setColor };
}
