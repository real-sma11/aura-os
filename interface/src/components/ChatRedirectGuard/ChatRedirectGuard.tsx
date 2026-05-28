import { Navigate, useLocation } from "react-router-dom";
import { useEffectiveMode } from "../../stores/use-effective-mode";
import { isChatPathname } from "../../utils/last-app-path";

/**
 * Phase 4 `p4_simple_pin_chat`: redirect every non-`/chat` pathname
 * to `/chat` when `effectiveMode === "simple"`. Wraps each
 * authenticated app route element so leaf-level URLs (`/projects/abc`,
 * `/feed/xyz`, etc.) bounce to Chat in Simple mode while Advanced
 * mode renders the active app's tree unchanged.
 *
 * Implemented as a route element rather than an effect so the
 * redirect happens during the same render — the user never sees a
 * one-frame flash of the non-Chat surface before navigation
 * resolves.
 */
export function ChatRedirectGuard({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const effectiveMode = useEffectiveMode();
  const location = useLocation();
  if (effectiveMode === "simple" && !isChatPath(location.pathname)) {
    return <Navigate to="/chat" replace />;
  }
  return <>{children}</>;
}

/**
 * Pure pathname predicate. Re-exported from `utils/last-app-path` so
 * the per-mode last-path tracking in `utils/storage` can share the
 * same rule without a components -> utils import. The local function
 * wrapper is preserved (rather than `export const`) so React Fast
 * Refresh keeps working — the `react-refresh/only-export-components`
 * rule disallows non-component value exports from a component file.
 */
export function isChatPath(pathname: string): boolean {
  return isChatPathname(pathname);
}
