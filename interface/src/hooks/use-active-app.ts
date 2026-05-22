import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { AuraApp } from "../apps/types";
import { resolveActiveApp } from "../stores/app-store";
import { apps as registeredApps } from "../apps/registry";
import { useEffectiveMode } from "../stores/use-effective-mode";

const CHAT_APP_ID = "chat";

/**
 * Resolves the currently-active app from the router's pathname.
 *
 * Deriving the active app synchronously from `useLocation()` (instead of
 * mirroring it into a zustand store via `useEffect`) ensures that shell
 * chrome — MainPanel, LeftPanel, SidekickPanel, etc. — is always in lockstep
 * with the URL. This eliminates the render where `activeApp` is stale after a
 * `navigate()` call, which previously allowed the outgoing panel to run
 * URL-driven effects that could hijack the new route.
 *
 * Phase 4 `p4_simple_pin_chat`: when `effectiveMode === "simple"`, the
 * chrome treats `ChatApp` as the active app regardless of the URL —
 * Simple mode is a single-app surface and any non-`/chat` path is
 * redirected to `/chat` by `<ChatRedirectGuard />` in `App.tsx`. The
 * pin lives at the hook layer (rather than the route tree) so the
 * sidebar's `AuthedSidebarBody`, sidekick panel, sidekick taskbar,
 * and `BottomTaskbar` all follow the override automatically without
 * the AuraShell needing to import from `apps/chat-app/`.
 */
export function useActiveApp(): AuraApp {
  const { pathname } = useLocation();
  const effectiveMode = useEffectiveMode();
  return useMemo(() => {
    if (effectiveMode === "simple") {
      const chat = registeredApps.find((app) => app.id === CHAT_APP_ID);
      if (chat) return chat;
    }
    return resolveActiveApp(pathname);
  }, [effectiveMode, pathname]);
}

/** Convenience helper for consumers that only need the id. */
export function useActiveAppId(): string {
  return useActiveApp().id;
}
