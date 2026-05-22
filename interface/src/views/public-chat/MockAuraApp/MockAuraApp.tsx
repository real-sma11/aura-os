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

export interface MockAuraAppProps {
  /**
   * Optional static wallpaper override. When provided, the
   * default `/AURA_visual_loop.mp4` video is replaced with an
   * `<img>` painted across the same 16:10 frame AND the dark
   * radial vignette is suppressed (the vignette was tuned for the
   * bright AURA orb in the default video; layering it over a
   * curated persona image just muddies the colors). Drives the
   * per-persona theme swap from `PublicChatView` — `personas.ts`
   * supplies the URL, the parent passes it down, and a `null`
   * here keeps the orb video loop and its vignette in place.
   */
  readonly desktopBackgroundUrl?: string | null;
}

export function MockAuraApp({
  desktopBackgroundUrl = null,
}: MockAuraAppProps = {}): ReactNode {
  const [clockLabel] = useState<string>(() => formatClock(new Date()));
  const hasCustomWallpaper = Boolean(desktopBackgroundUrl);

  return (
    <div className={styles.appFrame} data-testid="mock-aura-app">
      {hasCustomWallpaper ? (
        <img
          className={styles.wallpaper}
          src={desktopBackgroundUrl ?? undefined}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-testid="mock-aura-wallpaper-image"
        />
      ) : (
        <video
          className={styles.wallpaper}
          src="/AURA_visual_loop.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          data-testid="mock-aura-wallpaper-video"
        />
      )}
      {/*
       * The vignette was tuned for the bright AURA orb in the
       * default video — layered over a curated persona wallpaper
       * it reads as a heavy dark overlay that mutes the chosen
       * colors. Skip it whenever a static `desktopBackgroundUrl`
       * is in play; if a future persona theme needs its own
       * vignette, expose a `vignette` flag on `PersonaTheme`.
       */}
      {!hasCustomWallpaper && (
        <div
          className={styles.wallpaperVignette}
          aria-hidden="true"
          data-testid="mock-aura-wallpaper-vignette"
        />
      )}
      <DMWindowManager />
      <div
        className={styles.topChrome}
        data-testid="mock-aura-top-chrome"
        aria-hidden="true"
      >
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
                <span className={styles.taskbarIconButton}>
                  <PanelRight size={14} strokeWidth={2} />
                </span>
                <span className={styles.taskbarIconButton}>
                  <Minus size={12} strokeWidth={2} />
                </span>
                <span className={styles.taskbarIconButton}>
                  <Square size={12} strokeWidth={2} />
                </span>
                <span className={styles.taskbarIconButton}>
                  <X size={14} strokeWidth={2} />
                </span>
              </span>
            </span>
          }
          onDoubleClick={() => undefined}
        />
      </div>
      <div
        className={styles.bottomChrome}
        data-testid="mock-aura-bottom-chrome"
        aria-hidden="true"
      >
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
