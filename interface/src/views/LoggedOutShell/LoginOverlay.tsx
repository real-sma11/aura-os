import { useCallback, useEffect, useId, useRef } from "react";
import { Panel, Text } from "@cypher-asi/zui";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLoginForm } from "../LoginView/use-login-form";
import { LoginForm } from "../LoginView/LoginForm";
import { ResetPasswordForm } from "../LoginView/ResetPasswordForm";
import loginStyles from "../LoginView/LoginView.module.css";
import styles from "./LoggedOutShell.module.css";

/**
 * Logged-out variant of `LoginView`: same auth form chrome (Sign in /
 * Create Account tabs, password reset flow) wrapped in a centered
 * modal that overlays the public chat shell instead of replacing the
 * route entirely. The shell stays mounted behind a dim backdrop so
 * the visitor can close the modal (X / Esc / click outside) and drop
 * back into "public mode" without losing their place.
 *
 * Reuses `useLoginForm`, `LoginForm`, and `ResetPasswordForm` from
 * `views/LoginView` verbatim — only the framing chrome (titlebar +
 * full-bleed video background) is dropped, since `LoggedOutShell`
 * already owns those layers.
 */
export function LoginOverlay() {
  const navigate = useNavigate();
  const headingId = useId();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const f = useLoginForm();

  const handleClose = useCallback(() => {
    navigate("/");
  }, [navigate]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const handleOverlayMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Click on the dim backdrop (not the panel) closes the overlay.
      if (event.target === overlayRef.current) handleClose();
    },
    [handleClose],
  );

  return (
    <div
      ref={overlayRef}
      className={styles.loginOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onMouseDown={handleOverlayMouseDown}
    >
      <Panel
        variant="solid"
        border="solid"
        borderRadius="lg"
        className={`${loginStyles.card} ${styles.loginOverlayCard}`}
      >
        <button
          type="button"
          className={styles.loginOverlayClose}
          onClick={handleClose}
          aria-label="Close login"
          title="Close"
        >
          <X size={16} />
        </button>
        <Text id={headingId} align="center" className={loginStyles.cardTitle}>
          Login to AURA
        </Text>

        {f.showResetPassword ? (
          <ResetPasswordForm
            resetEmail={f.resetEmail}
            setResetEmail={f.setResetEmail}
            resetStatus={f.resetStatus}
            resetError={f.resetError}
            onSubmit={f.handleResetSubmit}
            onClose={f.closeResetPassword}
          />
        ) : (
          <LoginForm
            activeTab={f.activeTab}
            email={f.email}
            setEmail={f.setEmail}
            password={f.password}
            setPassword={f.setPassword}
            confirmPassword={f.confirmPassword}
            setConfirmPassword={f.setConfirmPassword}
            name={f.name}
            setName={f.setName}
            inviteCode={f.inviteCode}
            setInviteCode={f.setInviteCode}
            error={f.error}
            loading={f.loading}
            onTabChange={f.handleTabChange}
            onSubmit={f.handleSubmit}
            onForgotPassword={f.openResetPassword}
          />
        )}
      </Panel>
    </div>
  );
}
