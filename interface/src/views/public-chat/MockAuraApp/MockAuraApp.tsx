import { useState, type ReactNode } from "react";
import {
  ChevronRight,
  Circle,
  CreditCard,
  Folder,
  Globe,
  LayoutGrid,
  Minus,
  PanelLeft,
  PanelRight,
  Settings,
  Square,
  X,
} from "lucide-react";
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
 * The chrome is now visually 1:1 with a live Aura window: phase 1
 * layers the actual `ShellTitlebar` component (the same one mounted
 * by `AuraShell` in production) over the top via the `.topChrome`
 * overlay, and phase 2 layers three rounded `BottomTaskbar`-style
 * pills over the bottom via the `.bottomChrome` overlay. The pills
 * reuse the same `--shell-chrome-*` tokens that drive the real
 * `BottomTaskbar.module.css`, so margins, radii, blur, and border
 * colors stay in lockstep with the live shell.
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
function formatClock(date: Date): string {
  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutesPadded = minutes.toString().padStart(2, "0");
  return `${hours12}:${minutesPadded} ${period}`;
}

export function MockAuraApp(): ReactNode {
  const [clockLabel] = useState<string>(() => formatClock(new Date()));

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
      <div className={styles.bottomChrome} aria-hidden="true">
        <div className={`${styles.pill} ${styles.bottomLeft}`}>
          <span className={styles.taskbarIconButton}>
            <Circle size={14} strokeWidth={2} />
          </span>
          <span className={styles.favAvatar} />
          <span className={styles.favAvatar} />
        </div>
        <div className={`${styles.pill} ${styles.bottomCenter}`}>
          <span className={styles.taskbarIconButton}>
            <LayoutGrid size={14} strokeWidth={2} />
          </span>
          <span className={styles.taskbarIconButton}>
            <Folder size={14} strokeWidth={2} />
          </span>
          <span className={styles.taskbarIconButton}>
            <ChevronRight size={14} strokeWidth={2} />
          </span>
        </div>
        <div className={`${styles.pill} ${styles.bottomRight}`}>
          <span className={styles.taskbarIconButton}>
            <CreditCard size={14} strokeWidth={2} />
          </span>
          <span className={styles.taskbarIconButton}>
            <Settings size={14} strokeWidth={2} />
          </span>
          <span className={styles.taskbarIconButton}>
            <Globe size={14} strokeWidth={2} />
          </span>
          <span className={styles.clock}>{clockLabel}</span>
        </div>
      </div>
    </div>
  );
}
