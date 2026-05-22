import { Navigate, useLocation } from "react-router-dom";
import { useEffectiveMode } from "../../stores/use-effective-mode";

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
 * Pure pathname predicate. Exported for tests so the redirect rule
 * can be exercised without spinning up a router.
 */
export function isChatPath(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}
