import { useAuthStore } from "./auth-store";
import { selectEffectiveMode, type UIMode } from "./ui-mode-store";

/**
 * Composite hook that returns the *effective* UI mode chrome should
 * render. Fully derived from live auth:
 *
 * - Logged-out users always see `"public"`.
 * - Logged-in users always see the full `"standard"` shell.
 *
 * Reads the canonical `useAuthStore.user !== null` signal (the same
 * one `useAuth()` and `App.tsx`'s `showShell` derive from) so chrome
 * stays in lockstep with login/logout transitions.
 */
export function useEffectiveMode(): UIMode {
  const isAuthenticated = useAuthStore((s) => s.user !== null);
  return selectEffectiveMode(isAuthenticated);
}
