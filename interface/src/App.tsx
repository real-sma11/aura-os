import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  type Location,
} from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";
import { useAuraCapabilities } from "./hooks/use-aura-capabilities";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { ChatRedirectGuard } from "./components/ChatRedirectGuard";
import { NativeContextMenuOverride } from "./components/NativeContextMenuOverride";
import { LoginView } from "./views/LoginView";
import { PublicChatView } from "./views/public-chat/PublicChatView";
import { PublicMarketingPanel } from "./views/public-chat/PublicMarketingPanel";
import { CaptureLoginView } from "./views/CaptureLoginView";
import { apps } from "./apps/registry";
import { getInitialShellPath } from "./utils/last-app-path";
import { getLastApp } from "./utils/storage";
import { useEffectiveMode } from "./stores/use-effective-mode";
import { ChatAppRoute } from "./apps/chat-app/components/ChatAppRoute";
import { bootstrapNativeTestAuth } from "./lib/native-test-auth";
import { hydrateStoredAuth, isLoggedInSync } from "./shared/lib/auth-token";
import { preloadInitialShellApp } from "./lib/boot-shell";
import { reportBootError } from "./lib/boot-diagnostics";

const InviteAcceptView = lazy(() =>
  import("./views/InviteAcceptView").then((m) => ({ default: m.InviteAcceptView })),
);
const IdeView = lazy(() => import("./views/IdeView").then((m) => ({ default: m.IdeView })));
const ProductView = lazy(() =>
  import("./views/marketing/ProductView").then((m) => ({ default: m.ProductView })),
);
const ChangelogView = lazy(() =>
  import("./views/marketing/ChangelogView").then((m) => ({ default: m.ChangelogView })),
);
const FeedbackView = lazy(() =>
  import("./views/marketing/FeedbackView").then((m) => ({ default: m.FeedbackView })),
);
const PricingView = lazy(() =>
  import("./views/marketing/PricingView").then((m) => ({ default: m.PricingView })),
);

const initiallyLoggedIn = isLoggedInSync();

if (initiallyLoggedIn) {
  void preloadInitialShellApp();
}

function LastAppRedirect(): React.ReactElement {
  const effectiveMode = useEffectiveMode();
  // Phase 4 `p4_simple_pin_chat`: in Simple mode the only valid
  // landing surface is `/chat` — short-circuit before consulting the
  // last-visited app so a logged-out -> Simple sign-in lands on the
  // chat surface even if the user previously persisted a different
  // app id (e.g. `notes`).
  if (effectiveMode === "simple") {
    return <Navigate to="/chat" replace />;
  }
  const lastAppId = getLastApp();
  return <Navigate to={getInitialShellPath(lastAppId, null)} replace />;
}

function RouteFallback(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        color: "var(--color-text-muted)",
        fontSize: 12,
      }}
    >
      Loading...
    </div>
  );
}

/** Keeps AppShell chrome visible while lazy shell routes load (avoids full-app Suspense fallback). */
function ShellOutletSuspense(): React.ReactElement {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  );
}

/**
 * Phase 3 `/chat` route element. Picks the public chat surface
 * (compose banner + agent demo + sessions sidebar) when the
 * effective mode is `public`, otherwise renders the authenticated
 * Chat app's route component so the auth chat panel mounts inside
 * `AuraShell`'s `<main>` slot.
 *
 * Both branches render into the SAME `<Outlet />` slot inside
 * `AuraShell`, so flipping public <-> authed is a content swap, not
 * a shell remount.
 */
function ChatRouteSwitch(): React.ReactElement {
  const effectiveMode = useEffectiveMode();
  if (effectiveMode === "public") {
    return <PublicChatView />;
  }
  return <ChatAppRoute />;
}

/**
 * Phase 3 landing (`/`) route element. Public users see the public
 * chat surface (matching the previous `LoggedOutChatView` route);
 * authenticated users are redirected into their last-visited app
 * (or `/chat` when pinned to Simple mode — see `LastAppRedirect`
 * for the simple-mode short-circuit).
 */
function LandingRoute(): React.ReactElement {
  const effectiveMode = useEffectiveMode();
  if (effectiveMode === "public") {
    return <PublicChatView />;
  }
  return <LastAppRedirect />;
}

function UnknownRouteRedirect(): React.ReactElement {
  const effectiveMode = useEffectiveMode();
  if (effectiveMode === "public") {
    return <Navigate to="/chat" replace />;
  }
  return <Navigate to="/" replace />;
}

/**
 * Flattened list of app-owned routes. Each `AuraApp.routes[]` entry
 * becomes a `<Route>` under the shared `ShellOutletSuspense` layout
 * so the app module is the single source of truth for the pathnames
 * it handles. The Chat app's `/chat` index is filtered out below
 * because we mount it via `<ChatRouteSwitch>` so the public-mode
 * fallback can render in the same `<main>` slot without route
 * remount.
 */
const shellAppRoutes = apps.flatMap((app) => app.routes);

function isCaptureLoginRoute(location: { pathname: string; search: string }): boolean {
  if (location.pathname === "/capture-login") {
    return true;
  }
  const params = new URLSearchParams(location.search);
  return params.get("capture-login") === "1" || params.get("captureMode") === "login";
}

function renderRoutes(routes: typeof shellAppRoutes): React.ReactNode {
  return routes.map((route, index) => {
    const key = route.path ?? (route.index ? `index-${index}` : String(index));
    // Skip the chat app's `/chat` route here; it's mounted at the
    // parent level as `<ChatRouteSwitch>` so the public-vs-authed
    // picker can swap content without remounting the `<AuraShell>`
    // outlet host.
    if (route.path === "chat") return null;
    if (route.index) {
      return <Route key={key} index element={route.element} />;
    }
    return (
      <Route key={key} path={route.path} element={route.element}>
        {route.children ? renderRoutes(route.children) : null}
      </Route>
    );
  });
}

export function App(): React.ReactElement {
  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    let active = true;

    void (async () => {
      let shouldRestoreSession = true;
      try {
        if (isCaptureLoginRoute(window.location) && !isLoggedInSync()) {
          shouldRestoreSession = false;
          return;
        }
        await hydrateStoredAuth();
        await bootstrapNativeTestAuth();
      } catch (error) {
        reportBootError("auth bootstrap", error);
      } finally {
        if (active && shouldRestoreSession) {
          await restoreSession();
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [restoreSession]);

  return (
    <BrowserRouter>
      <NativeContextMenuOverride />
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes(): React.ReactElement {
  const location = useLocation();
  const { isNativeApp } = useAuraCapabilities();

  // "Background location" pattern: when a public-mode visitor opens
  // the login modal from a marketing page (or any other surface),
  // the trigger navigates to `/login?tab=...` with
  // `state.backgroundLocation` carrying the URL they came from. We
  // drive the top-level `<Routes>` matcher off that stashed
  // location so the underlying view (ProductView, PricingView, the
  // public chat landing, etc.) stays mounted while `AuraShell`
  // overlays `LoginOverlay` on top — see `AuraShell.isLoginRoute`,
  // which still keys off `useLocation().pathname` (the real `/login`)
  // so the overlay still mounts.
  //
  // Without `backgroundLocation` (direct deep link to `/login`,
  // `RequireAuth`'s `state.from` redirect, etc.) we fall through to
  // the real location and the route table behaves as before — the
  // `/login` path resolves to `<PublicChatView />` underneath.
  const navState = location.state as { backgroundLocation?: Location } | null;
  const routeLocation = navState?.backgroundLocation ?? location;

  if (isCaptureLoginRoute(location)) {
    return (
      <Routes>
        <Route path="*" element={<CaptureLoginView />} />
      </Routes>
    );
  }

  // Native mobile apps continue to mount `LoginView` as a full-page
  // route at `/login` (no underlying public chat surface to overlay).
  if (isNativeApp) {
    return (
      <Routes>
        <Route path="login" element={<LoginView />} />
        <Route path="capture-login" element={<CaptureLoginView />} />
        <Route
          path="ide"
          element={
            <Suspense fallback={<RouteFallback />}>
              <IdeView />
            </Suspense>
          }
        />
        <Route element={<AppShell />}>
          <Route element={<RequireAuth />}>
            <Route element={<ShellOutletSuspense />}>
              <Route index element={<LastAppRedirect />} />
              {renderRoutes(shellAppRoutes)}
              <Route path="chat" element={<ChatRouteSwitch />} />
            </Route>
            <Route
              path="invite/:token"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <InviteAcceptView />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Route>
      </Routes>
    );
  }

  // Phase 3 desktop/web routing: a single `<AppShell>` parent
  // wraps every route. AppShell provides the provider tree (auth
  // boot, modals, CaptureBridge) and renders `<AuraShell>` for
  // desktop (or `<MobileShell>` on mobile layouts). AuraShell uses
  // `<Outlet />` to mount per-route content in its `<main>` slot
  // and renders `LoginOverlay` internally when `pathname ===
  // "/login"`. Marketing routes (`/product`, `/changelog`,
  // `/feedback`, `/pricing`) also mount in this tree under
  // `<PublicMarketingPanel>`, so they share the same public-mode
  // chrome (titlebar + sidebar + `PublicSidebarFooter`) as the
  // chat landing surface — only the middle panel content swaps.
  return (
    <Routes location={routeLocation}>
      <Route path="capture-login" element={<CaptureLoginView />} />
      <Route
        path="ide"
        element={
          <Suspense fallback={<RouteFallback />}>
            <IdeView />
          </Suspense>
        }
      />
      <Route element={<AppShell />}>
        <Route element={<ShellOutletSuspense />}>
          <Route index element={<LandingRoute />} />
          <Route path="chat" element={<ChatRouteSwitch />} />
          <Route path="login" element={<PublicChatView />} />
          {/*
            Marketing routes mount inside the public-mode `AuraShell`
            main `<Outlet />` (replacing `PublicChatView`'s hero) via
            `PublicMarketingPanel`, a thin scroll-column wrapper. Same
            sidebar / titlebar / footer as the public chat landing —
            just the middle panel content swaps when the visitor
            clicks Product / Changelog / Feedback / Pricing in
            `PublicSidebarFooter`. Replaces the standalone
            `MarketingShell` chrome that previously owned these paths.
          */}
          <Route element={<PublicMarketingPanel />}>
            <Route
              path="product"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <ProductView />
                </Suspense>
              }
            />
            <Route
              path="changelog"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <ChangelogView />
                </Suspense>
              }
            />
            <Route
              path="feedback"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <FeedbackView />
                </Suspense>
              }
            />
            <Route
              path="pricing"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <PricingView />
                </Suspense>
              }
            />
          </Route>
          <Route element={<RequireAuth />}>
            <Route element={<SimpleModeChatRedirectLayout />}>
              {renderRoutes(shellAppRoutes)}
              <Route
                path="invite/:token"
                element={
                  <Suspense fallback={<RouteFallback />}>
                    <InviteAcceptView />
                  </Suspense>
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<UnknownRouteRedirect />} />
        </Route>
      </Route>
    </Routes>
  );
}

/**
 * Phase 4 layout route that wraps every authed leaf route except
 * `/chat` with the simple-mode redirect guard. Wrapping at the
 * layout layer (rather than per-route) keeps the route table small
 * and ensures every new app route inherits the pin without a
 * per-app code change.
 */
function SimpleModeChatRedirectLayout(): React.ReactElement {
  return (
    <ChatRedirectGuard>
      <Outlet />
    </ChatRedirectGuard>
  );
}

