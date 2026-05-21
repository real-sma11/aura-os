import { useCallback, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { BackgroundLayer } from "../../components/DesktopShell/BackgroundLayer";
import { LoggedOutTitlebar } from "./LoggedOutTitlebar";
import { LoggedOutSessionsPanel } from "./LoggedOutSessionsPanel";
import { LoginOverlay } from "./LoginOverlay";
import styles from "./LoggedOutShell.module.css";

/**
 * Top-level layout shell for the anonymous (logged-out) web
 * experience. Mirrors the spatial layout of
 * `components/DesktopShell` — a titlebar across the top, a left rail
 * with sessions + marketing footer, and a main panel for the chat
 * view — but without the bottom taskbar / window controls / org
 * selector affordances that only make sense once a user has signed in.
 *
 * Children render into the `<Outlet />` so the routing tree can swap
 * `LoggedOutChatView` for future logged-out routes without touching
 * this component. When the active route is `/login`, the
 * `LoginOverlay` is mounted on top of the shell so authentication
 * happens as a closable modal over the public chat surface (the
 * shell stays visible-but-dimmed behind it) instead of a separate
 * full-page route.
 */
export function LoggedOutShell() {
  const location = useLocation();
  const isLoginRoute = location.pathname === "/login";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className={styles.shell}>
      <BackgroundLayer />
      <LoggedOutTitlebar onMenuToggle={toggleSidebar} />
      <div className={styles.body}>
        {sidebarOpen && (
          <div
            className={styles.sidebarBackdrop}
            onClick={closeSidebar}
            aria-hidden="true"
          />
        )}
        <aside
          className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}
        >
          <LoggedOutSessionsPanel />
        </aside>
        <main className={styles.mainPanel}>
          <Outlet />
        </main>
      </div>
      {isLoginRoute && <LoginOverlay />}
    </div>
  );
}
