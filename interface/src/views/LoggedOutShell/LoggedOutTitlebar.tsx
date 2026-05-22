import { Link, useLocation } from "react-router-dom";
import { ShellTitlebar } from "../../components/ShellTitlebar";
import { WindowControls } from "../../components/WindowControls";
import styles from "./LoggedOutShell.module.css";

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
export function LoggedOutTitlebar() {
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
