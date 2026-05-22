import { Link, useLocation } from "react-router-dom";
import { Menu, Server } from "lucide-react";
import { Button } from "@cypher-asi/zui";
import { ShellTitlebar } from "../ShellTitlebar";
import { OrgSelector } from "../OrgSelector";
import { MenuBar } from "../MenuBar";
import { WindowControls } from "../WindowControls";
import { UpdatePill } from "../UpdateBanner";
import { EarnCreditsButton } from "../EarnCreditsButton";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { track } from "../../lib/analytics";
import type { UIMode } from "../../stores/ui-mode-store";
import styles from "./AuraShell.module.css";

export interface AuraTitlebarProps {
  /**
   * Effective UI mode. Drives leading/trailing slot content; the
   * outer `ShellTitlebar` wrapper has stable DOM identity across
   * every mode flip.
   */
  mode: UIMode;
  /** Public-only: mobile menu toggle. */
  onMobileMenuToggle?: () => void;
  /** Authenticated only: sidekick & split-screen toggles + host settings. */
  sidekickCollapsed?: boolean;
  onToggleSidekick?: () => void;
  splitScreenActive?: boolean;
  onToggleSplitScreen?: () => void;
  onOpenHostSettings?: () => void;
}

/**
 * AuraTitlebar wraps a single `<ShellTitlebar>` instance for every
 * effective UI mode. The wrapper component identity stays stable
 * across mode flips — only its `icon` (leading) and `actions`
 * (trailing) slot children swap based on `mode`. The wordmark
 * (`title`) is identical in all three modes.
 *
 * Layout:
 * - Leading slot:
 *   - Authenticated (`simple` | `advanced`): `OrgSelector` + `MenuBar`
 *     (ported from `DesktopTitlebar`).
 *   - Public: mobile menu button (ported from `LoggedOutTitlebar`).
 * - Trailing slot:
 *   - Authenticated: `UpdatePill` + optional host-settings button +
 *     `EarnCreditsButton` + `WindowControls` (with the sidekick /
 *     split-screen toggles plumbed through props).
 *   - Public: Log in / Sign up pills + `WindowControls`. The day/
 *     night theme toggle is intentionally not in the public titlebar —
 *     it lives only in the bottom-right `BottomTaskbar` cluster so
 *     unauthenticated visitors aren't given two redundant affordances
 *     for the same control. The "Sign up for free" pill is the
 *     primary CTA and inverts with theme via `.authPillPrimary`.
 */
export function AuraTitlebar(props: AuraTitlebarProps): React.ReactElement {
  const { mode } = props;
  const isPublic = mode === "public";

  return (
    <ShellTitlebar
      data-testid="aura-titlebar"
      icon={isPublic ? <PublicLeading onMenuToggle={props.onMobileMenuToggle} /> : <AuthedLeading />}
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
        isPublic ? (
          <PublicActions />
        ) : (
          <AuthedActions
            sidekickCollapsed={props.sidekickCollapsed ?? false}
            onToggleSidekick={props.onToggleSidekick}
            splitScreenActive={props.splitScreenActive ?? false}
            onToggleSplitScreen={props.onToggleSplitScreen}
            onOpenHostSettings={props.onOpenHostSettings}
          />
        )
      }
    />
  );
}

function AuthedLeading(): React.ReactElement {
  return (
    <span className={`${styles.titleLeading} titlebar-no-drag`}>
      <OrgSelector variant="icon" />
      <MenuBar />
    </span>
  );
}

function PublicLeading({ onMenuToggle }: { onMenuToggle?: () => void }): React.ReactElement | null {
  if (!onMenuToggle) return null;
  return (
    <button
      type="button"
      className={styles.menuToggle}
      onClick={onMenuToggle}
      aria-label="Toggle menu"
    >
      <Menu size={18} />
    </button>
  );
}

interface AuthedActionsProps {
  sidekickCollapsed: boolean;
  onToggleSidekick?: () => void;
  splitScreenActive: boolean;
  onToggleSplitScreen?: () => void;
  onOpenHostSettings?: () => void;
}

function AuthedActions({
  sidekickCollapsed,
  onToggleSidekick,
  splitScreenActive,
  onToggleSplitScreen,
  onOpenHostSettings,
}: AuthedActionsProps): React.ReactElement {
  const { features } = useAuraCapabilities();
  return (
    <div
      className={styles.titleActions}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <UpdatePill />
      {features.hostRetargeting && onOpenHostSettings && (
        <Button
          variant="ghost"
          size="sm"
          rounded="md"
          iconOnly
          aria-label="Open host settings"
          onClick={onOpenHostSettings}
        >
          <Server size={14} strokeWidth={2} />
        </Button>
      )}
      <EarnCreditsButton />
      <WindowControls
        sidekickCollapsed={sidekickCollapsed}
        onToggleSidekick={onToggleSidekick ?? (() => undefined)}
        splitScreenActive={splitScreenActive}
        onToggleSplitScreen={onToggleSplitScreen}
      />
    </div>
  );
}

function PublicActions(): React.ReactElement {
  const { search } = useLocation();
  // Preserve any existing query (notably `?session=...`) across the
  // trip into the login modal so the public chat surface stays
  // selected behind the overlay.
  const signinSearch = search || "";
  const signupParams = new URLSearchParams(search);
  signupParams.set("tab", "register");
  const signupSearch = `?${signupParams.toString()}`;

  return (
    <div className={`${styles.publicTitleActions} titlebar-no-drag`}>
      <Link
        to={{ pathname: "/login", search: signinSearch }}
        className={`${styles.authPill} ${styles.authPillSecondary}`}
        onClick={() => track("public_login_clicked", { source: "titlebar" })}
      >
        Log in
      </Link>
      <Link
        to={{ pathname: "/login", search: signupSearch }}
        className={`${styles.authPill} ${styles.authPillPrimary}`}
        onClick={() => track("public_signup_clicked", { source: "titlebar" })}
      >
        Sign up for free
      </Link>
      <WindowControls />
    </div>
  );
}
