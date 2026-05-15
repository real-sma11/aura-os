import { Link } from "react-router-dom";
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
            to="/login"
            className={`${styles.authPill} ${styles.authPillPrimary}`}
          >
            Log in
          </Link>
          <Link
            to="/login?tab=register"
            className={`${styles.authPill} ${styles.authPillSecondary}`}
          >
            Sign up for free
          </Link>
          <WindowControls />
        </div>
      }
    />
  );
}
