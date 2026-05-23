import {
  useEffect,
  useRef,
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

/**
 * Duration of the wallpaper cross-fade (matches the keyframe
 * length in `MockAuraApp.module.css`). Kept here as a constant
 * so the React effect that tears down the outgoing layer stays
 * in lockstep with the CSS animation — bump both together if
 * the easing ever needs to slow down.
 */
const WALLPAPER_FADE_MS = 220;

/**
 * Frozen snapshot of the visual fields that fully describe one
 * rendering of the wallpaper. Captured at the moment of a
 * persona swap so the outgoing layer can keep painting its
 * original crop / fit / scale while it fades out, even though
 * the parent has already moved on to the next persona's props.
 */
interface WallpaperSnapshot {
  readonly url: string | null;
  readonly position: string | null;
  readonly fit: "cover" | "contain" | null;
  readonly scale: number | null;
}

/**
 * Builds the optional inline style that pins the wallpaper
 * `<img>`'s crop, fit, and scale. Returns `undefined` when
 * every field is null so React skips the style prop entirely
 * (preserves the default `object-fit: cover` from the CSS
 * module). Shared between the entering (current) and leaving
 * (outgoing) layers so both paint with identical positioning.
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
  /**
   * Optional CSS `object-position` for the wallpaper `<img>`. Only
   * meaningful in `"cover"` fit mode (the default) — `"contain"`
   * mode leaves the image fully visible and `object-position`
   * just nudges it within its letterbox bars. `null` (the
   * default) defers to the browser's `50% 50%` (center-cropped).
   * Set when a curated portrait needs a non-centered crop
   * (e.g. `"center 20%"` to keep a head-and-shoulders subject
   * from getting sliced mid-chest by the 16:10 frame's default
   * center crop).
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
   * wallpaper `<img>`. When `null` the frame's default
   * near-black fill paints through. Pair with
   * `desktopBackgroundFit: "contain"` and a sampled match of
   * the image's natural background so the letterbox bars look
   * like an extension of the artwork.
   */
  readonly desktopBackgroundColor?: string | null;
  /**
   * Multiplier applied as `transform: scale(N)` on the wallpaper
   * `<img>` to zoom the rendered image in (>1) or out (<1) from
   * its baseline `object-fit` size. `.appFrame` carries
   * `overflow: hidden` so the scaled-up content is clipped
   * cleanly to the mock window rectangle. Defaults to no
   * transform when `null`.
   */
  readonly desktopBackgroundScale?: number | null;
  /**
   * Optional per-persona text/syntax palette derived by
   * `deriveChatPalette` from the active persona's
   * `siteBackgroundColor`. When supplied, every piece of text
   * inside the frame (DM bubbles, agent name labels, tool target
   * paths, terminal stream prose, and the global `hljs-*` syntax
   * tokens) re-tints to a palette that coordinates with the
   * wallpaper hue family. The fields land as
   * `--mock-text`/`--mock-text-secondary`/`--mock-text-muted` and
   * `--mock-hljs-*` custom properties on `.appFrame`; the
   * matching `[data-persona-themed="true"]` block in
   * `MockAuraApp.module.css` re-binds `--color-text*` (cascading
   * into every descendant) and overrides each `hljs-*` selector
   * scoped to this frame so the global highlight.js theme
   * stylesheet keeps painting unchanged everywhere else. A
   * `null` value (the `NO_THEME` personas) collapses the inline
   * style and keeps the existing shell tokens.
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
  const hasCustomWallpaper = Boolean(desktopBackgroundUrl);
  const currentSnapshot: WallpaperSnapshot = {
    url: desktopBackgroundUrl,
    position: desktopBackgroundPosition,
    fit: desktopBackgroundFit,
    scale: desktopBackgroundScale,
  };

  // Cross-fade state. `outgoing` holds the previous persona's
  // wallpaper config (captured at the moment of swap) so it can
  // paint one last frame with its own crop/fit/scale while
  // fading out, then unmount once the animation finishes.
  // `previousSnapshotRef` mirrors what was painted last render
  // so we can detect URL changes; `nextOutgoingIdRef` gives each
  // outgoing layer a fresh React `key` so rapid cascading swaps
  // don't reuse the same DOM element and accidentally short-
  // circuit the animation.
  const previousSnapshotRef = useRef<WallpaperSnapshot>(currentSnapshot);
  const nextOutgoingIdRef = useRef<number>(1);
  const [outgoing, setOutgoing] = useState<
    (WallpaperSnapshot & { readonly id: number }) | null
  >(null);

  // Capture the outgoing snapshot DURING render (not in a post-
  // commit effect) so the outgoing layer mounts in the SAME paint
  // as the entering layer. If we deferred this to `useEffect`,
  // there would be one browser frame between commits where only
  // the entering layer existed; on its next render the outgoing
  // layer would then mount at the leaving keyframe's `opacity: 1`
  // and visibly "pop in" before fading out. That race is hidden
  // for `cover`-fit wallpapers (the entering layer covers the
  // whole frame and masks the pop-in) but Cypher Punk uses
  // `object-fit: contain`, so its letterbox bars expose the
  // previous persona's wallpaper appearing for one frame. Doing
  // the swap in render keeps both layers in the same commit so
  // their fade-in / fade-out animations start synchronously and
  // the cross-fade reads as a clean blend at every fit mode.
  //
  // Only react to URL changes — bare position/fit/scale tweaks
  // on the same persona would slide rather than fade, and the
  // user contract is "wallpaper itself fades, never animates
  // its crop". The current behavior is "snap" on those, which
  // is fine because no persona currently mutates them without
  // also changing the URL.
  if (previousSnapshotRef.current.url !== currentSnapshot.url) {
    const id = nextOutgoingIdRef.current;
    nextOutgoingIdRef.current = id + 1;
    setOutgoing({ id, ...previousSnapshotRef.current });
    previousSnapshotRef.current = currentSnapshot;
  }

  // Tear the outgoing layer down a hair after the CSS animation
  // ends. We can't rely on `onAnimationEnd` because jsdom never
  // fires animation events under test, and a stalled outgoing
  // layer would compound on repeated swaps. The `+ 50ms` buffer
  // covers easing slop without producing a visible re-flash
  // (the leaving keyframe pins opacity at 0 via `forwards`).
  const outgoingId = outgoing?.id;
  useEffect(() => {
    if (outgoingId == null) return;
    const timer = window.setTimeout(() => {
      setOutgoing((current) =>
        current?.id === outgoingId ? null : current,
      );
    }, WALLPAPER_FADE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [outgoingId]);

  // Merge the optional palette vars with the optional bg-color
  // override into one style object. `desktopBackgroundColor`
  // paints behind the wallpaper `<img>` so `contain`-fit
  // wallpapers can match their natural background to the
  // letterbox bars.
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

  const currentWallpaperStyle = wallpaperStyleFor(currentSnapshot);

  return (
    <div
      className={styles.appFrame}
      data-testid="mock-aura-app"
      data-persona-themed={chatPalette ? "true" : undefined}
      style={frameStyle}
    >
      {/*
       * Outgoing wallpaper layer (cross-fade out). Rendered with
       * the previous persona's frozen snapshot so it stays at
       * its correct crop/fit/scale while fading. Mounts only
       * during the WALLPAPER_FADE_MS window after a persona
       * swap and tears itself down once the timer above fires.
       */}
      {outgoing &&
        (outgoing.url ? (
          <img
            key={`outgoing-${outgoing.id}`}
            className={`${styles.wallpaper} ${styles.wallpaperLeaving}`}
            src={outgoing.url}
            alt=""
            aria-hidden="true"
            draggable={false}
            data-testid="mock-aura-wallpaper-outgoing"
            style={wallpaperStyleFor(outgoing)}
          />
        ) : (
          <video
            key={`outgoing-${outgoing.id}`}
            className={`${styles.wallpaper} ${styles.wallpaperLeaving}`}
            src="/AURA_visual_loop.mp4"
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
            data-testid="mock-aura-wallpaper-outgoing"
          />
        ))}
      {hasCustomWallpaper ? (
        <img
          key={`current-${desktopBackgroundUrl}`}
          className={`${styles.wallpaper} ${styles.wallpaperEntering}`}
          src={desktopBackgroundUrl ?? undefined}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-testid="mock-aura-wallpaper-image"
          style={currentWallpaperStyle}
        />
      ) : (
        <video
          key="current-video-fallback"
          className={`${styles.wallpaper} ${styles.wallpaperEntering}`}
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
