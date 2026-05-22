import { useCallback, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { BackgroundLayer } from "../../components/DesktopShell/BackgroundLayer";
import { ModeToggle } from "../../components/ModeToggle";
import { PanelSearch } from "../../components/PanelSearch";
import { usePublicChatStore } from "../../stores/public-chat-store";
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
 *
 * The sidebar header owns the always-visible search input + the
 * Normie/Advanced mode toggle. Search filters the sessions list
 * (lifted to this component so the input + filter live in the same
 * place); the toggle's "always under search" placement matches the
 * Advanced shell's sidebar so the surface stays consistent across
 * mode flips.
 */
export function LoggedOutShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginRoute = location.pathname === "/login";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const [searchQuery, setSearchQuery] = useState("");
  const createSession = usePublicChatStore((s) => s.createSession);
  // The "+" button is supposed to land the user on a "New chat"
  // canvas — the same surface they'd see on a brand-new visit.
  // Without dedupe, every press mints a fresh session and the sidebar
  // accumulates orphan "New chat" rows that all point at empty
  // canvases. Worse, when the user is already sitting on an empty
  // session, the press visibly does nothing different (every empty
  // session renders the same `ComposePanel`), which reads as "the +
  // button didn't take me to a new chat screen". Reuse the most
  // recent zero-turn session if one already exists; only mint a new
  // id when every existing session has at least one turn.
  const handleNewChat = useCallback(() => {
    const { sessions, sessionOrder } = usePublicChatStore.getState();
    const existingEmptyId = sessionOrder.find((id) => {
      const session = sessions[id];
      return session != null && session.turns.length === 0;
    });
    const id = existingEmptyId ?? createSession();
    navigate(`/?session=${id}`);
  }, [createSession, navigate]);

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
          <div className={styles.sidebarHeader}>
            <PanelSearch
              placeholder="Search"
              value={searchQuery}
              onChange={setSearchQuery}
              action={
                <button
                  type="button"
                  className={styles.newChatButton}
                  onClick={handleNewChat}
                  aria-label="New chat"
                  title="New chat"
                >
                  <Plus size={14} />
                </button>
              }
            />
            <ModeToggle />
          </div>
          <LoggedOutSessionsPanel searchQuery={searchQuery} />
        </aside>
        <main className={styles.mainPanel}>
          <Outlet />
        </main>
      </div>
      {isLoginRoute && <LoginOverlay />}
    </div>
  );
}
