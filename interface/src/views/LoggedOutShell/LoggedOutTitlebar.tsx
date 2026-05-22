import { Link, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { ShellTitlebar } from "../../components/ShellTitlebar";
import { WindowControls } from "../../components/WindowControls";
import styles from "./LoggedOutShell.module.css";

interface LoggedOutTitlebarProps {
  onMenuToggle?: () => void;
}

/**
 * Logged-out variant of `components/DesktopShell/DesktopTitlebar`. The
 * `title` slot carries the AURA wordmark via the global
 * `.titlebar-center` helper so the wordmark lands at the same visual X
 * coordinate as the authenticated `DesktopTitlebar`, regardless of
 * what sits in the leading / trailing slots. The `icon` slot hosts the
 * mobile sidebar toggle (a hamburger button styled via `.menuToggle`,
 * which is `display: none` on desktop and only renders ≤640px), so
 * mobile users get a single tap target to surface the sessions
 * drawer without disturbing the centered wordmark on desktop. The
 * `actions` slot bundles the Log in / Sign up CTA pills with the
 * native `WindowControls` strip (minimize / maximize / close) on the
 * trailing (right) edge.
 */
export function LoggedOutTitlebar({ onMenuToggle }: LoggedOutTitlebarProps) {
  const { search } = useLocation();
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
        onMenuToggle ? (
          <button
            type="button"
            className={styles.menuToggle}
            onClick={onMenuToggle}
            aria-label="Toggle menu"
          >
            <Menu size={18} />
          </button>
        ) : undefined
      }
      title={
        <span className={`titlebar-center ${styles.titleCenter}`}>
          <img
            src="/AURA_logo_text_mark.png"
            alt="AURA"
            draggable={false}
            className={styles.titleLogo}
            data-aura-wordmark
          />
        </span>
      }
      actions={
        <div
          className={`${styles.titleActions} titlebar-no-drag`}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Link
            to={{ pathname: "/login", search: signinSearch }}
            className={`${styles.authPill} ${styles.authPillSecondary}`}
          >
            Log in
          </Link>
          <Link
            to={{ pathname: "/login", search: signupSearch }}
            className={`${styles.authPill} ${styles.authPillPrimary}`}
          >
            Sign up for free
          </Link>
          <WindowControls />
        </div>
      }
    />
  );
}
