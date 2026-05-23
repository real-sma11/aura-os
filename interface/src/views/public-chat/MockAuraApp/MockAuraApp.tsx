import {
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
import { paletteToCssVars, type ChatPalette } from "./derive-chat-palette";
import { useCrossFadeLayers } from "../cross-fade";
import crossFadeStyles from "../cross-fade.module.css";
import styles from "./MockAuraApp.module.css";

/**
 * Empty-state hero for the public chat surface. A flat 16:10
 * wallpaper rectangle hosts the scripted MSN/ICQ-style DM windows
 * that float over it, with the real `ShellTitlebar` overlaid on top
 * (phase 1) and three `BottomTaskbar`-style pills on the bottom
 * (phase 2). Both chrome overlays reuse the same `--shell-chrome-*`
 * tokens that drive the live shell, so margins, radii, blur, and
 * border colors stay in lockstep.
 *
 * The wallpaper itself is a per-persona `<img>` painted across the
 * frame. When the visitor swaps personas the previous wallpaper
 * stays mounted as an outgoing layer that fades out while the
 * incoming wallpaper fades in — the cross-fade lifecycle is owned
 * by `useCrossFadeLayers` (see `cross-fade.ts`). `PublicChatView`
 * decodes the new persona's assets BEFORE flipping the props it
 * passes here, so both the page bg and this wallpaper start their
 * fades together rather than popping in independently.
 *
 * NO_THEME personas (`giga-brain`, `researcher`) leave
 * `desktopBackgroundUrl` null. In that case no wallpaper layer is
 * rendered at all — the frame's own near-black fill shows through.
 *
 * All decorative children are `aria-hidden`. The only keyboard-
 * reachable surface in the empty state is the CTA button mounted
 * by the parent `PublicChatView`.
 */
function formatClock(date: Date): string {
  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutesPadded = minutes.toString().padStart(2, "0");
  return `${hours12}:${minutesPadded} ${period}`;
}

/**
 * Frozen snapshot of the visual fields that fully describe one
 * rendering of the wallpaper. The cross-fade hook keeps two of
 * these alive during a swap so the outgoing layer can keep
 * painting its original crop / fit / scale while it fades out,
 * even though the parent has already moved on to the next
 * persona's props.
 */
interface WallpaperSnapshot {
  readonly url: string | null;
  readonly position: string | null;
  readonly fit: "cover" | "contain" | null;
  readonly scale: number | null;
}

/**
 * Builds the optional inline style that pins the wallpaper
 * `<img>`'s crop, fit, and scale. Returns `undefined` when every
 * field is null so React skips the style prop entirely (preserves
 * the default `object-fit: cover` from the CSS module). Shared
 * between the entering and leaving layers so both paint with
 * identical positioning.
 */
function wallpaperStyleFor(
  snapshot: WallpaperSnapshot,
): CSSProperties | undefined {
  if (!snapshot.position && !snapshot.fit && snapshot.scale == null) {
    return undefined;
  }
  const style: CSSProperties = {};
  if (snapshot.position) style.objectPosition = snapshot.position;
  if (snapshot.fit) style.objectFit = snapshot.fit;
  if (snapshot.scale != null) style.transform = `scale(${snapshot.scale})`;
  return style;
}

export interface MockAuraAppProps {
  /**
   * Static wallpaper URL painted across the 16:10 frame. When
   * `null` no wallpaper layer mounts — the frame's own near-black
   * background fill shows through (used by `NO_THEME` personas).
   * Drives the per-persona theme swap from `PublicChatView` —
   * `personas.ts` supplies the URL, the parent passes it down.
   */
  readonly desktopBackgroundUrl?: string | null;
  /**
   * Optional CSS `object-position` for the wallpaper `<img>`. Only
   * meaningful in `"cover"` fit mode (the default) — `"contain"`
   * mode leaves the image fully visible and `object-position`
   * just nudges it within its letterbox bars. `null` (the
   * default) defers to the browser's `50% 50%` (center-cropped).
   */
  readonly desktopBackgroundPosition?: string | null;
  /**
   * `object-fit` mode for the wallpaper `<img>`. Defaults to
   * `"cover"` so the existing curated wallpapers (which were
   * authored at 16:10) keep filling the frame. Switch to
   * `"contain"` for tall portrait sources that should NOT be
   * cropped — pair it with `desktopBackgroundColor` so the
   * letterbox bars blend with the image's own background.
   */
  readonly desktopBackgroundFit?: "cover" | "contain" | null;
  /**
   * Solid color painted as the `.appFrame` background BEHIND the
   * wallpaper `<img>`. When `null` the frame's default near-black
   * fill paints through. Pair with `desktopBackgroundFit:
   * "contain"` and a sampled match of the image's natural
   * background so the letterbox bars look like an extension of
   * the artwork.
   */
  readonly desktopBackgroundColor?: string | null;
  /**
   * Multiplier applied as `transform: scale(N)` on the wallpaper
   * `<img>` to zoom the rendered image in (>1) or out (<1) from
   * its baseline `object-fit` size. `.appFrame` carries
   * `overflow: hidden` so scaled-up content is clipped cleanly
   * to the mock window rectangle. Defaults to no transform when
   * `null`.
   */
  readonly desktopBackgroundScale?: number | null;
  /**
   * Optional per-persona text/syntax palette derived by
   * `deriveChatPalette` from the active persona's
   * `siteBackgroundColor`. When supplied, every piece of text
   * inside the frame (DM bubbles, agent name labels, tool target
   * paths, terminal stream prose, and the global `hljs-*` syntax
   * tokens) re-tints to a palette that coordinates with the
   * wallpaper hue family. See the `[data-persona-themed="true"]`
   * block in `MockAuraApp.module.css` for the cascade.
   */
  readonly chatPalette?: ChatPalette | null;
}

export function MockAuraApp({
  desktopBackgroundUrl = null,
  desktopBackgroundPosition = null,
  desktopBackgroundFit = null,
  desktopBackgroundColor = null,
  desktopBackgroundScale = null,
  chatPalette = null,
}: MockAuraAppProps = {}): ReactNode {
  const [clockLabel] = useState<string>(() => formatClock(new Date()));
  const wallpaper: WallpaperSnapshot = {
    url: desktopBackgroundUrl,
    position: desktopBackgroundPosition,
    fit: desktopBackgroundFit,
    scale: desktopBackgroundScale,
  };

  // Signature is the URL so position/fit/scale tweaks on the same
  // wallpaper don't trigger a cross-fade. Falls back to a sentinel
  // string when the persona has no wallpaper at all so two
  // consecutive NO_THEME personas don't trigger a no-op fade of two
  // empty layers.
  const { outgoing: outgoingWallpaper, current: currentWallpaper } =
    useCrossFadeLayers(wallpaper, wallpaper.url ?? "__empty__");

  // Merge the optional palette vars with the optional bg-color
  // override into one style object. `desktopBackgroundColor` paints
  // behind the wallpaper `<img>` so `contain`-fit wallpapers can
  // match their natural background to the letterbox bars.
  const frameStyle: CSSProperties | undefined = (() => {
    if (!chatPalette && !desktopBackgroundColor) return undefined;
    const merged: CSSProperties = chatPalette
      ? (paletteToCssVars(chatPalette) as CSSProperties)
      : {};
    if (desktopBackgroundColor) {
      merged.backgroundColor = desktopBackgroundColor;
    }
    return merged;
  })();

  return (
    <div
      className={styles.appFrame}
      data-testid="mock-aura-app"
      data-persona-themed={chatPalette ? "true" : undefined}
      style={frameStyle}
    >
      {/*
       * Outgoing wallpaper layer. Mounts only during the cross-fade
       * window after a persona swap, then unmounts when
       * `useCrossFadeLayers` clears the outgoing slot. Carries the
       * previous snapshot's frozen crop/fit/scale so its visible
       * pixels stay locked while the opacity tweens to zero.
       */}
      {outgoingWallpaper?.url ? (
        <img
          key={`wallpaper-out-${outgoingWallpaper.__crossFadeId}`}
          className={`${styles.wallpaper} ${crossFadeStyles.layerLeaving}`}
          src={outgoingWallpaper.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-testid="mock-aura-wallpaper-outgoing"
          style={wallpaperStyleFor(outgoingWallpaper)}
        />
      ) : null}
      {currentWallpaper.url ? (
        <img
          key={`wallpaper-in-${currentWallpaper.url}`}
          className={`${styles.wallpaper} ${crossFadeStyles.layerEntering}`}
          src={currentWallpaper.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-testid="mock-aura-wallpaper-image"
          style={wallpaperStyleFor(currentWallpaper)}
        />
      ) : null}
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
