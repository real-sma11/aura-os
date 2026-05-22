import { useState, type ReactNode } from "react";
import {
  AppWindow,
  Folder,
  Globe,
  LayoutGrid,
  Minus,
  Settings,
  Square,
  X,
} from "lucide-react";
import { DMWindowManager } from "./DMWindowManager";
import styles from "./MockAuraApp.module.css";

/**
 * Empty-state hero for the public chat surface. Mocks the chrome of
 * the Aura desktop app — top titlebar with the AURA wordmark and
 * decorative window controls, a full-bleed wallpaper that re-uses
 * the existing `/AURA_visual_loop.mp4` video, several MSN/ICQ-style
 * DM windows floating over the wallpaper as agents trade messages
 * in parallel threads, an input dock slot the parent fills with the
 * real chat input + helper pills, and a thin decorative taskbar at
 * the bottom.
 *
 * The whole frame is decorative — `aria-hidden` is applied to the
 * titlebar, taskbar, and DM window manager. The only keyboard-
 * reachable surface is the `inputDock` children, which render the
 * shared `DesktopChatInputBar`.
 *
 * Mounts only on the public-chat empty state (see
 * `PublicChatView`'s `isEmpty` gate). Once the visitor sends their
 * first message the parent flips to the populated transcript layout
 * and this component unmounts entirely.
 */

interface MockAuraAppProps {
  /**
   * Slot for the helper-prompt pills + the shared
   * `DesktopChatInputBar`. Rendered inside the mock frame, just
   * above the decorative taskbar.
   */
  readonly inputDock: ReactNode;
}

export function MockAuraApp({ inputDock }: MockAuraAppProps): ReactNode {
  // Capture the time once on mount so the taskbar's clock reads the
  // viewer's local time (decorative — the demo is not meant to tick
  // every minute, just to feel like a real desktop screenshot).
  const [clockLabel] = useState<string>(() => formatClock(new Date()));

  return (
    <div className={styles.appFrame} data-testid="mock-aura-app">
      <div className={styles.titlebar} aria-hidden="true">
        <div className={styles.titlebarLeft}>
          <span className={styles.titlebarLogo}>
            <img
              src="/aura-icon.png"
              alt=""
              className={styles.titlebarLogoImg}
            />
          </span>
        </div>
        <div className={styles.titlebarCenter}>
          <span className={styles.titlebarWordmark}>AURA</span>
        </div>
        <div className={styles.titlebarRight}>
          <span className={styles.titlebarControl}>
            <Minus size={12} strokeWidth={2.2} />
          </span>
          <span className={styles.titlebarControl}>
            <Square size={10} strokeWidth={2.2} />
          </span>
          <span className={styles.titlebarControl}>
            <X size={12} strokeWidth={2.2} />
          </span>
        </div>
      </div>

      <div className={styles.body}>
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

      {inputDock !== null && inputDock !== undefined ? (
        <div className={styles.inputDock}>{inputDock}</div>
      ) : null}

      <div className={styles.taskbar} aria-hidden="true">
        <div className={styles.taskbarGroup}>
          <span className={styles.taskbarIcon}>
            <AppWindow size={13} strokeWidth={2} />
          </span>
          <span className={styles.taskbarIcon}>
            <Folder size={13} strokeWidth={2} />
          </span>
          <span className={styles.taskbarIcon}>
            <Globe size={13} strokeWidth={2} />
          </span>
        </div>
        <div className={styles.taskbarGroup}>
          <span className={styles.taskbarIcon}>
            <LayoutGrid size={13} strokeWidth={2} />
          </span>
        </div>
        <div className={styles.taskbarGroup}>
          <span className={styles.taskbarIcon}>
            <Settings size={13} strokeWidth={2} />
          </span>
          <span className={styles.taskbarClock}>{clockLabel}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Format the given `Date` as `h:mm AM/PM`. Pulled out as a helper so
 * tests can inject a known date instead of pulling on the host clock
 * (the public component captures `new Date()` once on mount, so a
 * future test that wants to pin the rendered string can render with
 * a frozen `Date` shim).
 */
function formatClock(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const paddedMinutes = minutes.toString().padStart(2, "0");
  return `${displayHours}:${paddedMinutes} ${meridiem}`;
}
