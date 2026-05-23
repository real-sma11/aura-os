import { useState, type CSSProperties, type ReactNode } from "react";
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
import styles from "./MockAuraApp.module.css";

/**
 * Empty-state hero for the public chat surface. A flat 16:10
 * wallpaper rectangle hosts the scripted MSN/ICQ-style DM windows
 * that float over it, with the real `ShellTitlebar` overlaid on top
 * (phase 1) and three `BottomTaskbar`-style pills on the bottom
 * (phase 2).
 *
 * Desktop background as one unit
 * ------------------------------
 * The wallpaper color and image are painted by a single child
 * `<div>` — `desktopBackgroundColor` lives on the wrapper, the
 * `<img>` is the wrapper's only child. The parent
 * (`PublicChatView`) drives the persona swap by toggling the
 * wrapper's opacity via the `desktopBackgroundOpacity` prop:
 * 1 → 0 fades the whole desktop background out, 0 → 1 fades the
 * new one in. Because color + image live on the same element they
 * always fade as one snapshot — the image never out-races the
 * color and vice versa.
 *
 * NO_THEME personas leave `desktopBackgroundUrl` and
 * `desktopBackgroundColor` both null. In that case the wallpaper
 * wrapper is omitted entirely and `.appFrame`'s own near-black
 * fill paints through.
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
 * Builds the optional inline style applied to the wallpaper
 * `<img>` itself — crop position, object-fit, and any
 * `transform: scale()` adjustment. Returns `undefined` when every
 * field is null so React skips the style prop entirely (and the
 * `object-fit: cover` default from the CSS module wins).
 */
function wallpaperImgStyle(
  position: string | null,
  fit: "cover" | "contain" | null,
  scale: number | null,
): CSSProperties | undefined {
  if (!position && !fit && scale == null) return undefined;
  const style: CSSProperties = {};
  if (position) style.objectPosition = position;
  if (fit) style.objectFit = fit;
  if (scale != null) style.transform = `scale(${scale})`;
  return style;
}

export interface MockAuraAppProps {
  /**
   * Static wallpaper URL painted across the 16:10 frame. When
   * `null` no wallpaper wrapper mounts — the frame's own near-
   * black background fill shows through (used by `NO_THEME`
   * personas). Drives the per-persona theme swap from
   * `PublicChatView`.
   */
  readonly desktopBackgroundUrl?: string | null;
  /**
   * Optional CSS `object-position` for the wallpaper `<img>`.
   * Only meaningful in `"cover"` fit mode (the default). `null`
   * defers to the browser's centered crop.
   */
  readonly desktopBackgroundPosition?: string | null;
  /**
   * `object-fit` mode for the wallpaper `<img>`. Defaults to
   * `"cover"`. Switch to `"contain"` for tall portrait sources
   * that should NOT be cropped — pair it with
   * `desktopBackgroundColor` so the letterbox bars blend with
   * the image's own background.
   */
  readonly desktopBackgroundFit?: "cover" | "contain" | null;
  /**
   * Solid color painted on the desktop-background wrapper BEHIND
   * the wallpaper `<img>`. When `null` and `desktopBackgroundUrl`
   * is also null the wrapper isn't mounted; when only the color
   * is null the wrapper still mounts (so the image carries the
   * fade) but no fill paints behind the image.
   */
  readonly desktopBackgroundColor?: string | null;
  /**
   * Multiplier applied as `transform: scale(N)` on the wallpaper
   * `<img>`. `.appFrame` clips with `overflow: hidden` so scaled
   * content is trimmed cleanly to the mock window rectangle.
   */
  readonly desktopBackgroundScale?: number | null;
  /**
   * Opacity of the desktop-background wrapper (color + image
   * together). The parent (`PublicChatView`) toggles this between
   * `1` and `0` to drive the persona-swap fade. CSS supplies the
   * transition; this prop is just the target opacity. Defaults
   * to `1` so a standalone render of `MockAuraApp` (e.g. in
   * isolated tests / Storybook) paints the wallpaper at full
   * opacity without any external state.
   */
  readonly desktopBackgroundOpacity?: number;
  /**
   * Optional per-persona text/syntax palette derived by
   * `deriveChatPalette` from the active persona's
   * `siteBackgroundColor`. When supplied, every piece of text
   * inside the frame re-tints to a palette that coordinates
   * with the wallpaper hue family. See the
   * `[data-persona-themed="true"]` block in
   * `MockAuraApp.module.css` for the cascade.
   */
  readonly chatPalette?: ChatPalette | null;
}

export function MockAuraApp({
  desktopBackgroundUrl = null,
  desktopBackgroundPosition = null,
  desktopBackgroundFit = null,
  desktopBackgroundColor = null,
  desktopBackgroundScale = null,
  desktopBackgroundOpacity = 1,
  chatPalette = null,
}: MockAuraAppProps = {}): ReactNode {
  const [clockLabel] = useState<string>(() => formatClock(new Date()));

  // The chat palette publishes per-persona text/syntax tokens onto
  // `.appFrame` as CSS custom properties; the desktop background
  // color does NOT — it paints the wallpaper wrapper below so it
  // fades with the image. Returns undefined when neither piece of
  // state is set so React skips the style prop entirely.
  const frameStyle: CSSProperties | undefined = chatPalette
    ? (paletteToCssVars(chatPalette) as CSSProperties)
    : undefined;

  const hasDesktopBackground =
    desktopBackgroundUrl != null || desktopBackgroundColor != null;

  return (
    <div
      className={styles.appFrame}
      data-testid="mock-aura-app"
      data-persona-themed={chatPalette ? "true" : undefined}
      style={frameStyle}
    >
      {/*
       * Desktop background. ONE element that holds the persona's
       * color (as `background-color` on the wrapper) and its
       * wallpaper `<img>` (the wrapper's only direct child). The
       * parent drives the persona-swap fade by toggling this
       * wrapper's opacity — color and image always dissolve as a
       * single snapshot. Omitted entirely for NO_THEME personas
       * so the frame's own near-black fill paints through cleanly.
       */}
      {hasDesktopBackground ? (
        <div
          className={styles.desktopBackground}
          style={{
            backgroundColor: desktopBackgroundColor ?? undefined,
            opacity: desktopBackgroundOpacity,
          }}
          aria-hidden="true"
          data-testid="mock-aura-desktop-bg"
        >
          {desktopBackgroundUrl ? (
            <img
              className={styles.wallpaperImage}
              src={desktopBackgroundUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              decoding="sync"
              data-testid="mock-aura-wallpaper-image"
              style={wallpaperImgStyle(
                desktopBackgroundPosition,
                desktopBackgroundFit,
                desktopBackgroundScale,
              )}
            />
          ) : null}
        </div>
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
