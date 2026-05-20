import { useEffect, useRef } from "react";
import { api } from "../../api/client";

/**
 * Cooldown between focus/visibility-triggered update checks. Prevents
 * rapid focus toggles (e.g. alt-tabbing, secondary monitors stealing focus
 * for a moment) from spamming the update endpoint while still keeping the
 * pill near-instant for the common case where a user comes back to the
 * window after a real absence.
 */
const MIN_FOCUS_CHECK_INTERVAL_MS = 60_000;

export interface UseFocusUpdateCheckOptions {
  /**
   * Whether the surrounding hook has determined the native updater is
   * actually available. When false the listener is not attached at all.
   */
  enabled: boolean;
  /**
   * Current backend status. We skip the focus-triggered check while an
   * install is in flight (`downloading` / `installing`) so we don't yank
   * a transient `checking` state over an active progress indicator.
   */
  status: string | undefined;
  /**
   * Refresh callback fired after `api.checkForUpdates()` resolves so the
   * caller can re-read the cached status. Usually the hook's `poll`.
   */
  onChecked: () => void | Promise<void>;
}

/**
 * Trigger an immediate `api.checkForUpdates()` whenever the window
 * regains focus or the document becomes visible. Used by both the
 * titlebar `UpdatePill` and the Settings `UpdateControl` so the pill
 * surfaces a fresh release without waiting for the next backend poll
 * tick or requiring a relaunch.
 */
export function useFocusUpdateCheck({
  enabled,
  status,
  onChecked,
}: UseFocusUpdateCheckOptions): void {
  const lastCheckRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  // Hold the current onChecked in a ref so the listener doesn't need to
  // be torn down and re-bound on every render of the parent hook.
  const onCheckedRef = useRef(onChecked);
  useEffect(() => {
    onCheckedRef.current = onChecked;
  }, [onChecked]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const maybeCheck = () => {
      if (status === "downloading" || status === "installing") return;
      if (inFlightRef.current) return;
      const now = Date.now();
      if (now - lastCheckRef.current < MIN_FOCUS_CHECK_INTERVAL_MS) return;
      lastCheckRef.current = now;
      inFlightRef.current = true;
      void (async () => {
        try {
          await api.checkForUpdates();
          await onCheckedRef.current();
        } catch {
          // Best-effort. The next periodic poll / next focus event will
          // try again; surfacing a banner here would be noisier than the
          // problem itself.
        } finally {
          inFlightRef.current = false;
        }
      })();
    };

    const handleFocus = () => maybeCheck();
    const handleVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") maybeCheck();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, status]);
}
