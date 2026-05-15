import { Link } from "react-router-dom";
import { ShellTitlebar } from "../../components/ShellTitlebar";
import styles from "./LoggedOutShell.module.css";

/**
 * Logged-out variant of `components/DesktopShell/DesktopTitlebar`. The
 * left slot is intentionally minimal (no `OrgSelector` or `MenuBar` —
 * those affordances only make sense once a session exists), and the
 * actions slot is replaced with two CTA pills that route into
 * `LoginView`. There are no `WindowControls`, `EarnCreditsButton`, or
 * host-settings menus because none of those primitives ship a useful
 * affordance for an anonymous visitor on the web build.
 */
export function LoggedOutTitlebar() {
  return (
    <ShellTitlebar
      icon={
        <span className={`${styles.titleLeading} titlebar-no-drag`}>
          <span className={styles.wordmark}>AURA</span>
        </span>
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
    />
  );
}
