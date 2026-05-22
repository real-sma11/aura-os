import type { ReactNode } from "react";
import { DMWindowManager } from "./DMWindowManager";
import styles from "./MockAuraApp.module.css";

/**
 * Empty-state hero for the public chat surface. Phase 0 strips this
 * down to a flat 16:10 wallpaper rectangle: the existing
 * `/AURA_visual_loop.mp4` video fills the frame, a soft radial
 * vignette sits above it, and the scripted MSN/ICQ-style DM windows
 * float over the wallpaper as agents trade messages in parallel
 * threads. There is no chrome at all in this phase — no titlebar,
 * no taskbar, no helper pills. Phases 1 and 2 will layer the real
 * `ShellTitlebar` and three bottom dock pills back in on top.
 *
 * The wallpaper and vignette are decorative — `aria-hidden` keeps
 * them out of the assistive-tech tree. The only keyboard-reachable
 * surface in the empty state is the `PublicComposeInput`, which the
 * parent `PublicChatView` mounts in its own bottom-anchored slot
 * (not inside this frame).
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
    </div>
  );
}
