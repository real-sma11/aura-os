/**
 * Simplified shell for web users after login.
 *
 * ChatGPT-style layout: sidebar (conversation list) + main chat panel.
 * No agents, projects, feed, or other apps visible. Composes the same
 * chat infrastructure (hooks, stores, API) as the full DesktopShell's
 * Chat app — just a different layout wrapper.
 *
 * Rendered inside `AppShell` so all authenticated providers, modals,
 * and context are available. The `ResponsiveShell` in `AppShell.tsx`
 * selects this component when the user's app-mode preference is
 * `"simple"` and the platform is web (no desktop bridge).
 */

import { Suspense, lazy, useCallback, useEffect } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { BackgroundLayer } from "../../components/DesktopShell/BackgroundLayer";
import { ShellTitlebar } from "../../components/ShellTitlebar";
import { WindowControls } from "../../components/WindowControls";
import { useAuth } from "../../stores/auth-store";
import { useAppModeStore } from "../../stores/app-mode-store";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { useProfileStore } from "../../stores/profile-store";
import { LoggedOutPanelFooter } from "../LoggedOutShell/LoggedOutPanelFooter";
import styles from "./SimpleShell.module.css";

const ChatAppLeftPanel = lazy(
  () =>
    import(
      "../../apps/chat-app/components/ChatAppLeftPanel/ChatAppLeftPanel"
    ).then((m) => ({ default: m.ChatAppLeftPanel })),
);

export function SimpleShell() {
  const { user, logout } = useAuth();
  const toggle = useAppModeStore((s) => s.toggle);
  const avatarUrl = useProfileStore((s) => s.profile.avatarUrl);
  const location = useLocation();
  const navigate = useNavigate();

  // Simple mode only shows the Chat app. If the router lands us on
  // a non-chat route (e.g. LastAppRedirect → /agents), redirect to
  // /chat so the user always sees the chat surface.
  useEffect(() => {
    if (!location.pathname.startsWith("/chat")) {
      navigate("/chat", { replace: true });
    }
  }, [location.pathname, navigate]);

  // Hydrate the agent store so the ChatAppLeftPanel has agents to
  // fan out session loads against. In DesktopShell this happens when
  // the Agents app mounts; here we trigger it on shell mount.
  useEffect(() => {
    void useAgentStore.getState().fetchAgents().catch(() => {});
  }, []);

  // Hydrate the profile store so the avatar URL resolves from
  // aura-network (S3-rehosted). In DesktopShell this happens when
  // the Profile app mounts; here we trigger it on shell mount.
  const initProfile = useProfileStore((s) => s.init);
  useEffect(() => {
    initProfile();
  }, [initProfile]);

  const initial = user?.display_name?.charAt(0)?.toUpperCase() ?? "?";

  const [, setSearchParams] = useSearchParams();
  const handleNewChat = useCallback(() => {
    // Clear any ?session= param to show the fresh canvas. If already
    // on /chat with no params, setSearchParams({}) is a no-op — the
    // user is already looking at a fresh canvas.
    if (location.pathname === "/chat") {
      setSearchParams({}, { replace: true });
    } else {
      navigate("/chat", { replace: true });
    }
  }, [location.pathname, navigate, setSearchParams]);

  return (
    <div className={styles.shell}>
      <BackgroundLayer />
      <ShellTitlebar
        icon={
          <span className={styles.titleLogoLeft}>
            <img
              src="/AURA_logo_text_mark.png"
              alt="AURA"
              draggable={false}
              className={styles.titleLogo}
              data-aura-wordmark
            />
          </span>
        }
        title={null}
        actions={
          <div
            className={`${styles.titleActions} titlebar-no-drag`}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <span className={styles.userInfo}>
              {avatarUrl && avatarUrl.startsWith("http") ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className={styles.userAvatar}
                />
              ) : (
                <span className={styles.userAvatarFallback}>{initial}</span>
              )}
              {user?.display_name}
            </span>
            <button
              type="button"
              className={styles.advancedToggle}
              onClick={toggle}
            >
              Advanced
            </button>
            <button
              type="button"
              className={styles.advancedToggle}
              onClick={() => void logout()}
            >
              Log out
            </button>
            <WindowControls />
          </div>
        }
      />
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>CHATS</span>
            <button
              type="button"
              className={styles.newChatButton}
              onClick={handleNewChat}
              aria-label="New chat"
            >
              <Plus size={14} />
            </button>
          </div>
          <button
            type="button"
            className={styles.newChatRow}
            onClick={handleNewChat}
          >
            New chat
          </button>
          <div className={styles.sidebarSessions}>
            <Suspense fallback={null}>
              <ChatAppLeftPanel />
            </Suspense>
          </div>
          <LoggedOutPanelFooter />
        </aside>
        <main className={styles.mainPanel}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
