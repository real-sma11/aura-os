import { useAuthStore } from "./auth-store";
import {
  selectEffectiveMode,
  useUIModeStore,
  type UIMode,
} from "./ui-mode-store";

/**
 * Composite hook that returns the *effective* UI mode chrome should
 * render — i.e. the persisted preference squashed against live auth.
 *
 * - Logged-out users always see `"public"`, regardless of what they
 *   may have persisted while signed in.
 * - A logged-in user whose persisted preference is `"public"` is
 *   squashed to `"simple"` (the ModeToggle never writes `"public"`).
 * - Otherwise the stored preference flows through unchanged.
 *
 * Reads the canonical `useAuthStore.user !== null` signal (the same
 * one `useAuth()` and `App.tsx`'s `showShell` derive from) so chrome
 * stays in lockstep with login/logout transitions. Centralising this
 * derivation here keeps shell components free of `selectEffectiveMode`
 * boilerplate and prevents accidental drift between callers.
 */
export function useEffectiveMode(): UIMode {
  const mode = useUIModeStore((s) => s.mode);
  const isAuthenticated = useAuthStore((s) => s.user !== null);
  return selectEffectiveMode({ mode, setMode: noop, toggleMode: noop }, isAuthenticated);
}

function noop(): void {
  /* selectEffectiveMode only reads state.mode; the function members
     are required by the UIModeState shape but never invoked here. */
}
