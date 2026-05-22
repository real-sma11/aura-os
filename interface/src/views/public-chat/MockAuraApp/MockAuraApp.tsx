import type { ReactNode } from "react";
import { Minus, PanelLeft, PanelRight, Square, X } from "lucide-react";
import { ShellTitlebar } from "../../../components/ShellTitlebar";
import { DMWindowManager } from "./DMWindowManager";
import styles from "./MockAuraApp.module.css";

/**
 * Empty-state hero for the public chat surface. The existing
 * `/AURA_visual_loop.mp4` video fills a flat 16:10 wallpaper
 * rectangle, a soft radial vignette sits above it, and the scripted
 * MSN/ICQ-style DM windows float over the wallpaper as agents trade
 * messages in parallel threads.
 *
 * Phase 1 layers the actual `ShellTitlebar` component (the same one
 * mounted by `AuraShell` in production) over the wallpaper as an
 * absolute `.topChrome` overlay with mock decorative children for the
 * three slots — the rounded pill margin/radius/blur all come for free
 * from `ShellTitlebar`'s own `.alignRail` rule. Phase 2 will add the
 * three bottom dock pills.
 *
 * The wallpaper, vignette, and overlay chrome are decorative —
 * `aria-hidden` keeps them out of the assistive-tech tree. The only
 * keyboard-reachable surface in the empty state is the
 * `PublicComposeInput`, which the parent `PublicChatView` mounts in
 * its own bottom-anchored slot (not inside this frame).
 *
 * Mounts only on the public-chat empty state (see
 * `PublicChatView`'s `isEmpty` gate). Once the visitor sends their
 * first message the parent flips to the populated transcript layout
 * and this component unmounts entirely.
 */
export function MockAuraApp(): ReactNode {
  return (
    <div className={styles.appFrame} data-testid="mock-aura-app">
      <video
        className={styles.wallpaper}
        src="/AURA_visual_loop.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />
      <div className={styles.wallpaperVignette} aria-hidden="true" />
      <DMWindowManager />
      <div className={styles.topChrome} aria-hidden="true">
        <ShellTitlebar
          icon={
            <span className="titlebar-no-drag">
              <span className={styles.titlebarLeading}>
                <PanelLeft size={14} strokeWidth={2} />
              </span>
            </span>
          }
          title={
            <span className="titlebar-center">
              <img
                src="/AURA_logo_text_mark.png"
                alt="AURA"
                className={styles.titleLogo}
                draggable={false}
              />
            </span>
          }
          actions={
            <span className="titlebar-no-drag">
              <span className={styles.titlebarActions}>
                <PanelRight size={14} strokeWidth={2} />
                <Minus size={12} strokeWidth={2} />
                <Square size={12} strokeWidth={2} />
                <X size={14} strokeWidth={2} />
              </span>
            </span>
          }
          onDoubleClick={() => undefined}
        />
      </div>
    </div>
  );
}
