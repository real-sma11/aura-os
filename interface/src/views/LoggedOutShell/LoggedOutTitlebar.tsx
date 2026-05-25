import { Link, useLocation } from "react-router-dom";
import { Menu, Sun, Moon } from "lucide-react";
import { useTheme } from "@cypher-asi/zui";
import { track } from "../../lib/analytics";
import { cycleTheme, getThemeToggleIconKind, getThemeToggleAriaLabel } from "../../lib/theme-toggle";
import { ShellTitlebar } from "../../components/ShellTitlebar";
import { WindowControls } from "../../components/WindowControls";
import styles from "./LoggedOutShell.module.css";

interface LoggedOutTitlebarProps {
  onMenuToggle?: () => void;
}

/**
 * Logged-out variant of `components/DesktopShell/DesktopTitlebar`. The
 * `icon` slot carries the AURA wordmark on the leading (left) edge, the
 * `title` slot is intentionally empty (no centered wordmark), and the
 * `actions` slot bundles the Log in / Sign up CTA pills with the native
 * `WindowControls` strip (minimize / maximize / close) on the trailing
 * (right) edge so the anonymous shell keeps parity with the
 * authenticated `DesktopTitlebar` window chrome when running inside the
 * desktop app.
 */
const THEME_ICON = { sun: Sun, moon: Moon } as const;

export function LoggedOutTitlebar({ onMenuToggle }: LoggedOutTitlebarProps) {
  const { search } = useLocation();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const ThemeIcon = THEME_ICON[getThemeToggleIconKind(theme, resolvedTheme)];
  // Preserve the active session id (and any other query the public
  // chat view writes) across the trip into the login modal. Without
  // this, clicking "Log in" / "Sign up" strips `?session=...` from
  // the URL, which causes `LoggedOutChatView` to re-enter its
  // auto-create branch on the `/login` route and mint a fresh empty
  // chat row in the sidebar every time the modal is opened.
  const signinSearch = search || "";
  const signupParams = new URLSearchParams(search);
  signupParams.set("tab", "register");
  const signupSearch = `?${signupParams.toString()}`;

  return (
    <ShellTitlebar
      icon={
        <span className={styles.titleLogoLeft}>
          {onMenuToggle && (
            <button
              type="button"
              className={styles.menuToggle}
              onClick={onMenuToggle}
              aria-label="Toggle menu"
            >
              <Menu size={18} />
            </button>
          )}
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
          <button
            type="button"
            className={styles.themeToggle}
            onClick={() => setTheme(cycleTheme(theme, resolvedTheme))}
            aria-label={getThemeToggleAriaLabel(theme, resolvedTheme)}
          >
            <ThemeIcon size={16} />
          </button>
          <Link
            to={{ pathname: "/login", search: signinSearch }}
            className={`${styles.authPill} ${styles.authPillPrimary}`}
            onClick={() => track("public_login_clicked", { source: "titlebar" })}
          >
            Log in
          </Link>
          <Link
            to={{ pathname: "/login", search: signupSearch }}
            className={`${styles.authPill} ${styles.authPillSecondary}`}
            onClick={() => track("public_signup_clicked", { source: "titlebar" })}
          >
            Sign up for free
          </Link>
          <WindowControls />
        </div>
      }
    />
  );
}
