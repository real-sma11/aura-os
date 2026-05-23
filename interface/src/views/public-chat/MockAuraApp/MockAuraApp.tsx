import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
import { PERSONAS } from "../personas";
import styles from "./MockAuraApp.module.css";

// Default `background-position` for the avatar dock when a persona
// doesn't override `avatarObjectPosition`. With `background-size:
// 200%` (the dock's hard-coded zoom) this lands the upper-third
// slice of the source portrait in the 18px circle — where the head
// sits on every existing character portrait.
const AVATAR_DEFAULT_OBJECT_POSITION = "50% 18%";

/*
 * Fish-eye magnification tunables for the bottom-left persona dock.
 * The dock paints each avatar at `AVATAR_BASE_SIZE_PX` (matches the
 * CSS module's `.personaAvatar` width/height) and, while the pointer
 * hovers the `.bottomLeft` pill, inflates each one based on its
 * horizontal distance from the cursor.
 *
 * A raised-cosine falloff (same family the macOS dock uses) maps
 * distances in `[0, INFLUENCE_RADIUS_PX]` onto sizes in
 * `[AVATAR_MAX_SIZE_PX, AVATAR_BASE_SIZE_PX]` — smooth at both ends,
 * peaking at the cursor and decaying to no magnification past the
 * radius. Avatars further than the radius stay at base size, so the
 * effect is local to the cursor's immediate neighbourhood the way a
 * dock magnifier feels.
 */
const AVATAR_BASE_SIZE_PX = 18;
const AVATAR_MAX_SIZE_PX = 36;
const INFLUENCE_RADIUS_PX = 80;

function computeAvatarSize(distancePx: number): number {
  if (distancePx >= INFLUENCE_RADIUS_PX) return AVATAR_BASE_SIZE_PX;
  const t = distancePx / INFLUENCE_RADIUS_PX;
  const falloff = 0.5 * (1 + Math.cos(Math.PI * t));
  return (
    AVATAR_BASE_SIZE_PX +
    (AVATAR_MAX_SIZE_PX - AVATAR_BASE_SIZE_PX) * falloff
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Empty-state hero for the public chat surface. A flat 16:10
 * wallpaper rectangle hosts the scripted MSN/ICQ-style DM windows
 * that float over it, with the real `ShellTitlebar` overlaid on top
 * (phase 1) and three `BottomTaskbar`-style pills on the bottom
 * (phase 2).
 *
 * Desktop background — layered dissolve
 * -------------------------------------
 * Each persona's desktop background is painted as a single
 * `.desktopBackground` `<div>` that carries the persona color on
 * itself and holds the wallpaper `<img>` as its only child —
 * color + image are always one unit. During a persona swap the
 * parent passes an additional `outgoingDesktopBackground`
 * snapshot, and we mount a second `.desktopBackground` element
 * ON TOP of the new one with a fade-out animation. The new layer
 * underneath sits at full opacity the entire time, so as the
 * outgoing layer dissolves the new pixels are revealed beneath
 * it — no dark midpoint, no parent-bg leak.
 *
 * NO_THEME personas leave `desktopBackgroundUrl` and
 * `desktopBackgroundColor` both null. In that case the wallpaper
 * wrapper is omitted entirely and `.appFrame`'s own near-black
 * fill paints through.
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
 * field is null so React skips the style prop entirely and the
 * `object-fit: cover` default from the CSS module wins.
 */
function wallpaperImgStyle(
  position: string | null | undefined,
  fit: "cover" | "contain" | null | undefined,
  scale: number | null | undefined,
): CSSProperties | undefined {
  if (!position && !fit && scale == null) return undefined;
  const style: CSSProperties = {};
  if (position) style.objectPosition = position;
  if (fit) style.objectFit = fit;
  if (scale != null) style.transform = `scale(${scale})`;
  return style;
}

/**
 * Frozen snapshot of the previous persona's desktop-background
 * fields, passed in while that snapshot is fading out. `fadeKey`
 * is a monotonically-increasing token the parent bumps on every
 * swap so React mounts a fresh `<div>` per swap (and a rapid
 * second click can't reuse the in-flight outgoing layer's animation
 * state).
 */
export interface OutgoingDesktopBackground {
  readonly url: string | null;
  readonly position: string | null;
  readonly fit: "cover" | "contain" | null;
  readonly color: string | null;
  readonly scale: number | null;
  readonly fadeKey: number;
}

export interface MockAuraAppProps {
  /**
   * Static wallpaper URL painted across the 16:10 frame. When
   * `null` no wallpaper wrapper mounts — the frame's own near-
   * black background fill shows through (used by `NO_THEME`
   * personas).
   */
  readonly desktopBackgroundUrl?: string | null;
  /**
   * Optional CSS `object-position` for the wallpaper `<img>`.
   * Only meaningful in `"cover"` fit mode.
   */
  readonly desktopBackgroundPosition?: string | null;
  /**
   * `object-fit` mode for the wallpaper `<img>`. Defaults to
   * `"cover"`.
   */
  readonly desktopBackgroundFit?: "cover" | "contain" | null;
  /**
   * Solid color painted on the desktop-background wrapper BEHIND
   * the wallpaper `<img>`. When both this and
   * `desktopBackgroundUrl` are null the wrapper isn't mounted at
   * all and `.appFrame`'s own near-black fill paints through.
   */
  readonly desktopBackgroundColor?: string | null;
  /**
   * Multiplier applied as `transform: scale(N)` on the wallpaper
   * `<img>`. `.appFrame` clips with `overflow: hidden` so scaled
   * content is trimmed cleanly to the mock window rectangle.
   */
  readonly desktopBackgroundScale?: number | null;
  /**
   * Snapshot of the PREVIOUS persona's desktop background,
   * supplied while it dissolves out. Mounts a second
   * `.desktopBackground` `<div>` ON TOP of the current one with
   * a fade-out animation; the new layer's pixels sit underneath
   * at full opacity the whole time, so as the outgoing dissolves
   * they're revealed beneath. `null` outside of a swap window.
   *
   * Owned by the parent (`PublicChatView`) so a standalone
   * render of `MockAuraApp` for isolated tests / Storybook never
   * carries an outgoing layer and just paints the current
   * snapshot.
   */
  readonly outgoingDesktopBackground?: OutgoingDesktopBackground | null;
  /**
   * Optional per-persona text/syntax palette derived by
   * `deriveChatPalette` from the active persona's
   * `siteBackgroundColor`.
   */
  readonly chatPalette?: ChatPalette | null;
  /**
   * Index into `PERSONAS` of the avatar that should paint with the
   * "selected" border in the bottom-left dock. Defaults to `0`
   * (Vibecoder) so a standalone render of `MockAuraApp` for
   * isolated tests / Storybook still picks a deterministic active
   * avatar without needing external state.
   */
  readonly activePersonaIndex?: number;
  /**
   * Click handler invoked when the visitor picks an avatar in the
   * bottom-left dock. Mirrors the contract `PersonaTickRail` uses
   * for `onActiveIndexChange`, so the parent (`PublicChatView`)
   * can route both entry points into the same `setActiveIndex`
   * call and the two surfaces stay in lockstep. Defaults to a
   * no-op so standalone renders are clickable but inert.
   */
  readonly onPersonaSelect?: (index: number) => void;
}

export function MockAuraApp({
  desktopBackgroundUrl = null,
  desktopBackgroundPosition = null,
  desktopBackgroundFit = null,
  desktopBackgroundColor = null,
  desktopBackgroundScale = null,
  outgoingDesktopBackground = null,
  chatPalette = null,
  activePersonaIndex = 0,
  onPersonaSelect,
}: MockAuraAppProps = {}): ReactNode {
  const [clockLabel] = useState<string>(() => formatClock(new Date()));

  /*
   * Per-avatar live size (in px) for the fish-eye dock magnifier.
   * Initialised to `AVATAR_BASE_SIZE_PX` so the dock paints at its
   * natural size on first render and when the pointer is outside
   * the `.bottomLeft` pill. The array length tracks `PERSONAS` so a
   * persona swap doesn't desync — `PERSONAS` is a frozen module
   * constant so a single initialiser is safe.
   */
  const [avatarSizes, setAvatarSizes] = useState<number[]>(() =>
    PERSONAS.map(() => AVATAR_BASE_SIZE_PX),
  );
  /*
   * One ref slot per persona button so the pointer-move handler can
   * read each avatar's current screen-space center via
   * `getBoundingClientRect()` without re-querying the DOM by class.
   * The `.map()` below assigns into `avatarRefs.current[index]` via
   * a ref callback during the commit phase, so the slots are
   * guaranteed to be filled before any pointer event fires.
   * `PERSONAS` is a frozen module-level constant so the array
   * length never needs to be reconciled at runtime.
   */
  const avatarRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const resetAvatarSizes = useCallback(() => {
    setAvatarSizes((prev) => {
      const allBase = prev.every((size) => size === AVATAR_BASE_SIZE_PX);
      if (allBase) return prev;
      return PERSONAS.map(() => AVATAR_BASE_SIZE_PX);
    });
  }, []);

  const handleDockPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Respect the user's reduced-motion preference: keep every
      // avatar at the base size so there is no magnification at
      // all. Mirrors the CSS rule that zeroes the transition.
      if (prefersReducedMotion()) {
        resetAvatarSizes();
        return;
      }
      const cursorX = event.clientX;
      const nextSizes = avatarRefs.current.map((node) => {
        if (!node) return AVATAR_BASE_SIZE_PX;
        const rect = node.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        return computeAvatarSize(Math.abs(cursorX - centerX));
      });
      setAvatarSizes((prev) => {
        if (
          prev.length === nextSizes.length &&
          prev.every((size, index) => size === nextSizes[index])
        ) {
          return prev;
        }
        return nextSizes;
      });
    },
    [resetAvatarSizes],
  );

  const frameStyle: CSSProperties | undefined = chatPalette
    ? (paletteToCssVars(chatPalette) as CSSProperties)
    : undefined;

  const hasCurrentDesktopBg =
    desktopBackgroundUrl != null || desktopBackgroundColor != null;
  const hasOutgoingDesktopBg =
    outgoingDesktopBackground != null &&
    (outgoingDesktopBackground.url != null ||
      outgoingDesktopBackground.color != null);

  return (
    <div
      className={styles.appFrame}
      data-testid="mock-aura-app"
      data-persona-themed={chatPalette ? "true" : undefined}
      style={frameStyle}
    >
      {/*
       * Current desktop background — paints the new persona's
       * color + image at full opacity, no animation. Sits BENEATH
       * the outgoing layer below; as the outgoing dissolves
       * these pixels are revealed.
       */}
      {hasCurrentDesktopBg ? (
        <div
          className={styles.desktopBackground}
          style={{
            backgroundColor: desktopBackgroundColor ?? undefined,
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
      {/*
       * Outgoing desktop background — mounts on top of the current
       * one only while the parent is mid-swap, carries the OLD
       * persona's color + image, and fades from opacity 1 → 0 via
       * the `.desktopBackgroundLeaving` keyframe animation. React
       * unmounts it `FADE_MS + 50ms` later; until then this is the
       * sole element animating, so the swap reads as the old
       * pixels dissolving into the new ones underneath.
       */}
      {hasOutgoingDesktopBg && outgoingDesktopBackground ? (
        <div
          key={`mock-aura-desktop-bg-out-${outgoingDesktopBackground.fadeKey}`}
          className={`${styles.desktopBackground} ${styles.desktopBackgroundLeaving}`}
          style={{
            backgroundColor: outgoingDesktopBackground.color ?? undefined,
          }}
          aria-hidden="true"
          data-testid="mock-aura-desktop-bg-outgoing"
        >
          {outgoingDesktopBackground.url ? (
            <img
              className={styles.wallpaperImage}
              src={outgoingDesktopBackground.url}
              alt=""
              aria-hidden="true"
              draggable={false}
              decoding="sync"
              style={wallpaperImgStyle(
                outgoingDesktopBackground.position,
                outgoingDesktopBackground.fit,
                outgoingDesktopBackground.scale,
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
                data-aura-wordmark
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
        <div
          className={`${styles.pill} ${styles.bottomLeft}`}
          data-testid="mock-aura-bottom-left"
          // Fish-eye magnifier handlers live on the pill itself so
          // the effect stays active while the cursor crosses the
          // gaps between avatars. `onPointerLeave` resets every
          // avatar to base size; the CSS transition on width/height
          // animates the shrink-back smoothly.
          onPointerMove={handleDockPointerMove}
          onPointerLeave={resetAvatarSizes}
        >
          <span className={styles.taskbarIconButton}>
            <Circle size={14} strokeWidth={2} />
          </span>
          {PERSONAS.map((persona, index) => {
            const isActive = index === activePersonaIndex;
            const { desktopBackgroundUrl: avatarUrl, avatarObjectPosition } =
              persona.theme;
            // Persona portraits live at the same URL the mock
            // wallpaper uses. We zoom the source 2x via
            // `background-size: 200%` and slide the upper-third
            // slice into view via `background-position` so the
            // head ends up centered in the 18px circle. NO_THEME
            // personas have no image at all; they fall back to
            // the initial-letter card below so the dock still
            // shows one circle per persona.
            const liveSize = avatarSizes[index] ?? AVATAR_BASE_SIZE_PX;
            const avatarStyle: CSSProperties = {
              width: `${liveSize}px`,
              height: `${liveSize}px`,
              ...(avatarUrl
                ? {
                    backgroundImage: `url(${avatarUrl})`,
                    backgroundPosition:
                      avatarObjectPosition ?? AVATAR_DEFAULT_OBJECT_POSITION,
                  }
                : null),
            };
            return (
              <button
                key={persona.id}
                type="button"
                ref={(node) => {
                  avatarRefs.current[index] = node;
                }}
                className={styles.personaAvatar}
                data-active={isActive ? "true" : "false"}
                data-persona-id={persona.id}
                data-testid={`mock-aura-avatar-${persona.id}`}
                // The whole `bottomChrome` carries `aria-hidden`
                // because it's decorative mock chrome; keyboard
                // users select personas via the right-edge
                // `PersonaTickRail`. `tabIndex={-1}` keeps the
                // avatars out of the focus order so AT users
                // don't land on hidden buttons.
                tabIndex={-1}
                style={avatarStyle}
                onClick={() => onPersonaSelect?.(index)}
              >
                {!avatarUrl ? (
                  <span className={styles.personaAvatarFallback}>
                    {persona.name.charAt(0)}
                  </span>
                ) : null}
              </button>
            );
          })}
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
