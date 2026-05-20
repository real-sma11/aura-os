import { useEffect, useId, useRef } from "react";
import { Link } from "react-router-dom";
import styles from "./KeepChattingModal.module.css";

/**
 * Non-dismissable modal mounted whenever the public-mode 3-turn cap
 * has been hit. There is intentionally NO close button, NO
 * overlay-click handler, and NO Esc key handler — the only exits are
 * the two CTAs. The component transitions out automatically when the
 * user signs in (which transitions the whole tree out of
 * `LoggedOutShell`).
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="true"` mark the panel.
 *   - `aria-labelledby` points at the heading.
 *   - Initial focus is sent to the primary CTA on mount.
 */
export function KeepChattingModal() {
  const headingId = useId();
  const primaryButtonRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className={styles.panel}>
        <h2 id={headingId} className={styles.heading}>
          Thanks for trying AURA
        </h2>
        <p className={styles.body}>
          Log in or sign up to keep chatting
        </p>
        <div className={styles.actions}>
          <Link
            ref={primaryButtonRef}
            to="/login"
            className={`${styles.pill} ${styles.pillPrimary}`}
          >
            Log in
          </Link>
          <Link
            to="/login?tab=register"
            className={`${styles.pill} ${styles.pillSecondary}`}
          >
            Sign up for free
          </Link>
        </div>
      </div>
    </div>
  );
}
