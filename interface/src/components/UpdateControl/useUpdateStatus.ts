import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type {
  DesktopUpdateBundleInfo,
  DesktopUpdateStatusResponse,
} from "../../shared/api/desktop";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";

const POLL_INTERVAL = 5_000;

const TERMINAL_STATUSES = new Set([
  "up_to_date",
  "available",
  "failed",
  "idle",
]);

export type UpdateStatusValue =
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up_to_date"
  | "failed"
  | "idle"
  | "unknown";

export interface UpdateStatusState {
  supported: boolean;
  loaded: boolean;
  status: UpdateStatusValue;
  currentVersion: string | null;
  availableVersion: string | null;
  error: string | null;
  lastStep: string | null;
  lastCheckedAt: number | null;
  /**
   * Lazily-fetched classification of the running app bundle. Only
   * carries actionable signal on macOS — `null` until the first failed
   * install (or until `bundleInfo` is read explicitly). See
   * `DesktopUpdateBundleInfo`.
   */
  bundleInfo: DesktopUpdateBundleInfo | null;
  checkPending: boolean;
  installPending: boolean;
  revealPending: boolean;
  relocatePending: boolean;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  revealUpdaterLogs: () => Promise<void>;
  /**
   * macOS-only: copy the running bundle into `/Applications`, clear its
   * quarantine xattr, then relaunch and exit. The current process will
   * disappear on success, so this never resolves on the happy path —
   * resolves only on cancel / error.
   */
  relocateAndRelaunch: () => Promise<void>;
}

/**
 * Heuristic match for the macOS read-only-filesystem failure that the
 * preflight reports as `update install failed: …` plus the older raw
 * `cargo_packager_updater` error. We rely on the substring rather than
 * the structured `last_step` because users on builds older than the
 * preflight commit will still hit the latter — and we want both to
 * trigger the bundle-info fetch + recovery card.
 */
function isReadOnlyMountFailure(
  status: UpdateStatusValue,
  error: string | null,
  lastStep: string | null,
): boolean {
  if (status !== "failed") return false;
  if (lastStep === "preflight_failed") return true;
  if (!error) return false;
  // EROFS surfaces verbatim from std::io::Error on macOS.
  return /read-only file system/i.test(error);
}

export function useUpdateStatus(): UpdateStatusState {
  const { features } = useAuraCapabilities();
  const [data, setData] = useState<DesktopUpdateStatusResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [checkPending, setCheckPending] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const [relocatePending, setRelocatePending] = useState(false);
  const [bundleInfo, setBundleInfo] = useState<DesktopUpdateBundleInfo | null>(
    null,
  );
  const bundleInfoFetchedRef = useRef(false);
  const mountedRef = useRef(true);

  const supported = !!features.nativeUpdater && data?.supported !== false;

  const poll = useCallback(async () => {
    try {
      const next = await api.getUpdateStatus();
      if (!mountedRef.current) return;
      setData(next);
      setLoaded(true);
      if (TERMINAL_STATUSES.has(next.update.status)) {
        setLastCheckedAt(Date.now());
      }
      if (next.update.status !== "checking") {
        setCheckPending(false);
      }
      if (next.update.status !== "available") {
        setInstallPending(false);
      }
    } catch {
      if (mountedRef.current) {
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!features.nativeUpdater) return;
    void poll();
  }, [features.nativeUpdater, poll]);

  useEffect(() => {
    if (!features.nativeUpdater) return;
    if (data?.supported === false) return;
    const id = setInterval(() => {
      void poll();
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [features.nativeUpdater, data?.supported, poll]);

  const checkForUpdates = useCallback(async () => {
    if (!features.nativeUpdater) return;
    setCheckPending(true);
    try {
      await api.checkForUpdates();
      await poll();
    } catch {
      if (mountedRef.current) {
        setCheckPending(false);
      }
    }
  }, [features.nativeUpdater, poll]);

  const installUpdate = useCallback(async () => {
    if (!features.nativeUpdater) return;
    setInstallPending(true);
    try {
      await api.installUpdate();
      await poll();
    } catch {
      if (mountedRef.current) {
        setInstallPending(false);
      }
    }
  }, [features.nativeUpdater, poll]);

  const revealUpdaterLogs = useCallback(async () => {
    if (!features.nativeUpdater) return;
    setRevealPending(true);
    try {
      await api.revealUpdateLogs();
    } catch {
      // noop — the underlying handler also writes the failure to
      // updater.log, so users can still inspect what went wrong.
    } finally {
      if (mountedRef.current) {
        setRevealPending(false);
      }
    }
  }, [features.nativeUpdater]);

  const relocateAndRelaunch = useCallback(async () => {
    if (!features.nativeUpdater) return;
    setRelocatePending(true);
    try {
      // On the happy path the response never arrives — the backend
      // calls process::exit before serialising the body. We still poll
      // afterwards so a *failed* relocate (user cancels osascript prompt,
      // permission denied, …) refreshes the visible status.
      await api.relocateAndRelaunch();
      await poll();
    } catch {
      // Network errors are expected when the backend exits cleanly
      // mid-request; treat them the same as a successful exit and stop
      // the spinner. The relaunched bundle will reload the page.
    } finally {
      if (mountedRef.current) {
        setRelocatePending(false);
      }
    }
  }, [features.nativeUpdater, poll]);

  const status = (data?.update.status ?? "unknown") as UpdateStatusValue;
  const availableVersion = data?.update.version ?? null;
  const currentVersion = data?.current_version ?? null;
  const error = data?.update.error ?? null;
  const lastStep =
    data?.update.last_step ?? data?.last_persisted_state?.step ?? null;

  // Lazy-fetch the bundle classification when (and only when) we have a
  // failure that smells like a read-only-mount problem. Once fetched we
  // cache it for the lifetime of the hook — a healthy bundle does not
  // become unhealthy without a relaunch, and a re-fetch on every render
  // would needlessly hammer `statfs`.
  useEffect(() => {
    if (!features.nativeUpdater) return;
    if (bundleInfoFetchedRef.current) return;
    if (!isReadOnlyMountFailure(status, error, lastStep)) return;
    bundleInfoFetchedRef.current = true;
    void (async () => {
      try {
        const info = await api.getUpdateBundleInfo();
        if (!mountedRef.current) return;
        setBundleInfo(info);
      } catch {
        // Best-effort. The recovery card simply won't render if the
        // fetch fails; the user still sees the underlying error.
        bundleInfoFetchedRef.current = false;
      }
    })();
  }, [features.nativeUpdater, status, error, lastStep]);

  return {
    supported,
    loaded,
    status,
    currentVersion,
    availableVersion,
    error,
    lastStep,
    lastCheckedAt,
    bundleInfo,
    checkPending,
    installPending,
    revealPending,
    relocatePending,
    checkForUpdates,
    installUpdate,
    revealUpdaterLogs,
    relocateAndRelaunch,
  };
}
