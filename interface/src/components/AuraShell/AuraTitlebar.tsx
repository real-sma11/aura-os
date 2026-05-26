import { Link, useLocation } from "react-router-dom";
import { PanelLeft, Server } from "lucide-react";
import { Button } from "@cypher-asi/zui";
import { ShellTitlebar } from "../ShellTitlebar";
import { MenuBar, MenuShortcuts } from "../MenuBar";
import { WindowControls } from "../WindowControls";
import { UpdatePill } from "../UpdateBanner";
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
  /**
   * Public-only: collapse state of the left sidebar (sessions panel).
   * Drives the `<PanelLeft />` drawer button's `selected` /
   * `aria-pressed` so it lights up when the drawer is open and goes
   * neutral when it is collapsed — the left-side mirror of the
   * `<PanelRight />` sidekick toggle in `WindowControls`.
   */
  publicSidebarCollapsed?: boolean;
  /** Public-only: toggle action for the left drawer. */
  onTogglePublicSidebar?: () => void;
  /**
   * Authenticated-only: collapse state of the authed left sidebar.
   * Drives the same `<PanelLeft />` drawer toggle the public shell
   * uses, just bound to a separate store field so the two shells
   * remember independent positions.
   */
  authedSidebarCollapsed?: boolean;
  /** Authenticated-only: toggle action for the authed left drawer. */
  onToggleAuthedSidebar?: () => void;
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
 * (trailing) slot children swap based on `mode`. The `title` slot's
 * outer `<span className="titlebar-center">` wrapper is also stable
 * across modes; only its inner content swaps — authenticated modes
 * render the AURA wordmark `<img>`, public mode leaves the slot
 * empty so logged-out visitors aren't shown the brand twice (the
 * marketing surfaces already carry the wordmark) and the center
 * drag region reads as clean window chrome.
 *
 * Layout:
 * - Leading slot (all modes): `<PanelLeft />` drawer toggle that
 *   opens / closes the left sidebar. Mirrors the `<PanelRight />`
 *   sidekick toggle in `WindowControls.tsx` 1:1 — same ZUI `Button`
 *   props (`variant="ghost"`, `size="sm"`, `iconOnly`,
 *   `selected={!collapsed}`, `aria-pressed`) and the same neutral-
 *   text override on `[aria-pressed="true"]`. Public and authed
 *   shells each bind the toggle to their own collapse state so the
 *   two drawers remember independent positions. Authenticated modes
 *   additionally mount headless `MenuShortcuts` (always) and the
 *   visible `MenuBar` (File / Edit / View / Help) in Advanced only —
 *   Simple is chat-only and never shows the application menu, but
 *   the global keyboard shortcuts the menu publishes (Ctrl+N, Ctrl+,,
 *   F11, zoom, etc.) still fire in Simple via the headless companion.
 *   The team selector (`OrgSelector`) lives in the bottom taskbar's
 *   `.left` cluster (right after `ProfilePill`) instead of the
 *   titlebar. In Advanced the Desktop icon now leads the `.center`
 *   cluster, so it no longer sits adjacent to the org selector.
 * - Trailing slot:
 *   - Authenticated: `UpdatePill` + optional host-settings button +
 *     `WindowControls` (with the sidekick / split-screen toggles
 *     plumbed through props). The referral CTA lives in the left
 *     sidebar footer (`AuraSidebar`'s `AuthedSidebarFooter`) — not
 *     in the titlebar.
 *   - Public: Log In / Sign Up pills + `WindowControls`. The day/
 *     night theme toggle is intentionally not in the public titlebar —
 *     it lives only in the bottom-right `BottomTaskbar` cluster so
 *     unauthenticated visitors aren't given two redundant affordances
 *     for the same control. The "Sign Up" pill is the
 *     primary CTA and inverts with theme via `.authPillPrimary`.
 */
export function AuraTitlebar(props: AuraTitlebarProps): React.ReactElement {
  const { mode } = props;
  const isPublic = mode === "public";

  return (
    <ShellTitlebar
      data-testid="aura-titlebar"
      icon={
        isPublic ? (
          <PublicLeading
            collapsed={props.publicSidebarCollapsed ?? true}
            onToggle={props.onTogglePublicSidebar}
          />
        ) : (
          <AuthedLeading
            mode={mode}
            collapsed={props.authedSidebarCollapsed ?? false}
            onToggle={props.onToggleAuthedSidebar}
          />
        )
      }
      title={
        <span className={`titlebar-center ${styles.titleCenter}`}>
          {!isPublic && (
            <img
              src="/AURA_logo_text_mark.png"
              alt="AURA"
              draggable={false}
              className={styles.titleLogo}
              data-aura-wordmark
            />
          )}
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

function AuthedLeading({
  mode,
  collapsed,
  onToggle,
}: {
  mode: UIMode;
  collapsed: boolean;
  onToggle?: () => void;
}): React.ReactElement {
  // `MenuShortcuts` is headless (`null`) and installs the document-
  // level shortcut listener for both Simple and Advanced. The visible
  // `MenuBar` only mounts in Advanced — Simple is a chat-only surface
  // and never shows the File / Edit / View / Help bar.
  const isAdvanced = mode === "advanced";
  return (
    <span
      className={`${styles.titleLeading} titlebar-no-drag`}
      // The titlebar treats unhandled double-clicks as a window-
      // maximize gesture (see `ShellTitlebar`'s default
      // `onDoubleClick`). Without this stop, a fast double-tap on
      // the drawer toggle ends up maximizing the OS window — the
      // exact same fix `AuthedActions` applies to its trailing
      // cluster, mirrored here for the authed leading slot.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {onToggle && (
        <SidebarDrawerToggle collapsed={collapsed} onToggle={onToggle} />
      )}
      <MenuShortcuts />
      {isAdvanced && <MenuBar />}
    </span>
  );
}

function PublicLeading({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle?: () => void;
}): React.ReactElement | null {
  if (!onToggle) return null;
  return (
    <span
      className={`${styles.titleLeading} titlebar-no-drag`}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <SidebarDrawerToggle collapsed={collapsed} onToggle={onToggle} />
    </span>
  );
}

/**
 * The shared `<PanelLeft />` drawer toggle used across every mode
 * (public / simple / advanced). Mirrors the right-side sidekick
 * toggle in `WindowControls.tsx` 1:1 so the two drawers feel like a
 * symmetric affordance pair — same ZUI `Button` props, same
 * `aria-pressed` contract (open=true, collapsed=false), and the
 * same `[aria-pressed="true"]` neutral-text override defined in
 * `AuraShell.module.css` under `.publicSidebarToggle`. The class
 * name is shared (and therefore "public" in name only) because the
 * styling rule is identical regardless of which collapse state
 * field the caller is bound to.
 */
function SidebarDrawerToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <Button
      variant="ghost"
      size="sm"
      rounded="md"
      iconOnly
      selected={!collapsed}
      title="Toggle sidebar"
      aria-label="Toggle sidebar"
      aria-pressed={!collapsed}
      className={styles.publicSidebarToggle}
      onClick={onToggle}
    >
      <PanelLeft size={14} strokeWidth={2} />
    </Button>
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
      <WindowControls
        sidekickCollapsed={sidekickCollapsed}
        // Pass through `undefined` (rather than substituting a no-op
        // function) so `WindowControls` can drop the `Toggle sidekick`
        // / `Toggle split screen` icon buttons entirely when the host
        // has opted out — this is what gives Simple mode a clean
        // titlebar trailing cluster (min/max/close only).
        onToggleSidekick={onToggleSidekick}
        splitScreenActive={splitScreenActive}
        onToggleSplitScreen={onToggleSplitScreen}
      />
    </div>
  );
}

function PublicActions(): React.ReactElement {
  const location = useLocation();
  const { search } = location;
  // Preserve any existing query (notably `?session=...`) across the
  // trip into the login modal so the public chat surface stays
  // selected behind the overlay.
  const signinSearch = search || "";
  const signupParams = new URLSearchParams(search);
  signupParams.set("tab", "register");
  const signupSearch = `?${signupParams.toString()}`;

  // Stash the current location as `state.backgroundLocation` so
  // `AppRoutes` keeps the underlying surface (e.g. ProductView,
  // PricingView, the public chat surface) mounted while
  // `AuraShell` overlays `LoginOverlay`. Without this state the
  // current view would unmount and `PublicChatView` would flash
  // in behind the modal.
  const backgroundState = { backgroundLocation: location };

  return (
    <div className={`${styles.publicTitleActions} titlebar-no-drag`}>
      <Link
        to={{ pathname: "/login", search: signinSearch }}
        state={backgroundState}
        className={`${styles.authPill} ${styles.authPillSecondary}`}
        onClick={() => track("public_login_clicked", { source: "titlebar" })}
      >
        Log In
      </Link>
      <Link
        to={{ pathname: "/login", search: signupSearch }}
        state={backgroundState}
        className={`${styles.authPill} ${styles.authPillPrimary}`}
        onClick={() => track("public_signup_clicked", { source: "titlebar" })}
      >
        Sign Up
      </Link>
      <WindowControls />
    </div>
  );
}
