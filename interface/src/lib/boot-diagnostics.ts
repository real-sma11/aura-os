const BOOT_STATUS_KEY = "aura-boot-diagnostics";
const MAX_ENTRIES = 20;

type BootStatusBridge = {
  mark?: (phase: string) => void;
  fail?: (message: string, detail?: string) => void;
  clear?: () => void;
};

type BootDiagnosticEntry = {
  at: string;
  kind: "phase" | "error";
  phase: string;
  message?: string;
};

let handlersInstalled = false;

function bootStatusBridge(): BootStatusBridge | undefined {
  return typeof window === "undefined" ? undefined : window.__AURA_BOOT_STATUS__;
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "Unknown error";
}

function readEntries(): BootDiagnosticEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BOOT_STATUS_KEY);
    const parsed = raw ? (JSON.parse(raw) as BootDiagnosticEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntry(entry: BootDiagnosticEntry): void {
  if (typeof window === "undefined") return;
  try {
    const entries = [...readEntries(), entry].slice(-MAX_ENTRIES);
    window.localStorage.setItem(BOOT_STATUS_KEY, JSON.stringify(entries));
  } catch {
    // Boot diagnostics must never become another startup failure.
  }
}

export function markBootPhase(phase: string): void {
  writeEntry({ at: new Date().toISOString(), kind: "phase", phase });
  bootStatusBridge()?.mark?.(phase);
  console.info("[aura-boot]", phase);
}

export function reportBootError(phase: string, error: unknown): void {
  const message = safeMessage(error);
  writeEntry({ at: new Date().toISOString(), kind: "error", phase, message });
  bootStatusBridge()?.fail?.("AURA hit a startup error.", `${phase}: ${message}`);
  console.error(`[aura-boot] ${phase} failed`, error);
}

export function clearBootStatus(): void {
  bootStatusBridge()?.clear?.();
}

export function installBootErrorHandlers(): void {
  if (handlersInstalled || typeof window === "undefined") {
    return;
  }
  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    const target = event.target as HTMLElement | null;
    let src = "";
    if (target instanceof HTMLScriptElement) {
      src = target.src;
    } else if (target instanceof HTMLLinkElement) {
      src = target.href;
    }
    reportBootError("window error", event.error ?? event.message ?? src);
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportBootError("unhandled promise rejection", event.reason);
  });
}

const STORAGE_PRESSURE_THRESHOLD_BYTES = 3 * 1024 * 1024;
const STORAGE_PRESSURE_TOP_N = 5;

/**
 * Boot-time diagnostic: surface localStorage pressure as a single
 * `console.warn` (NOT `console.error` — `installBootErrorHandlers`
 * promotes uncaught errors and unhandled rejections into a startup
 * failure banner). Walks every key once, sums `key.length +
 * value.length` (UTF-16 char counts, a fine byte-size proxy in
 * practice), and only logs when total usage exceeds ~3 MB. Wrapped
 * end-to-end in try/catch so a diagnostic can never break boot.
 */
export function markStoragePressure(): void {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return;
    }
    const storage = window.localStorage;
    const entries: Array<{ key: string; bytes: number }> = [];
    let total = 0;
    const length = storage.length;
    for (let i = 0; i < length; i += 1) {
      try {
        const key = storage.key(i);
        if (key === null) continue;
        const value = storage.getItem(key);
        const bytes = key.length + (value?.length ?? 0);
        total += bytes;
        entries.push({ key, bytes });
      } catch {
        // Skip entries we cannot read; diagnostic must never throw.
      }
    }
    if (total <= STORAGE_PRESSURE_THRESHOLD_BYTES) return;
    const topKeys = entries
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, STORAGE_PRESSURE_TOP_N)
      .map((entry) => ({ key: entry.key, kb: Math.round(entry.bytes / 1024) }));
    console.warn("[aura-boot] localStorage pressure", {
      totalKB: Math.round(total / 1024),
      topKeys,
    });
  } catch {
    // Diagnostics must never become another startup failure.
  }
}
