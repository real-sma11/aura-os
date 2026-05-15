import { Link } from "react-router-dom";
import { ShellTitlebar } from "../../components/ShellTitlebar";
import styles from "./LoggedOutShell.module.css";

/**
 * Logged-out variant of `components/DesktopShell/DesktopTitlebar`. The
 * `icon` slot now hosts the Log in / Sign up CTA pills (left), the
 * `title` slot is intentionally empty (no centered wordmark), and the
 * `actions` slot carries the AURA wordmark on the far right per the
 * logged-out layout spec.
 */
export function LoggedOutTitlebar() {
  return (
    <ShellTitlebar
      icon={
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
        </div>
      }
      title={null}
      actions={
        <span className={styles.titleLogoRight}>
          <img
            src="/AURA_logo_text_mark.png"
            alt="AURA"
            draggable={false}
            className={styles.titleLogo}
            data-aura-wordmark
          />
        </span>
      }
    />
  );
}
