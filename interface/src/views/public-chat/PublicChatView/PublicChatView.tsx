import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@cypher-asi/zui";
import { ArrowRight } from "lucide-react";
import { ComposePanel } from "../ComposePanel";
import { PersonaTickRail } from "../PersonaTickRail";
import { deriveChatPalette } from "../MockAuraApp/derive-chat-palette";
import { PERSONAS, getPersonaAt } from "../personas";
import styles from "./PublicChatView.module.css";

/**
 * Right-side surface for the public (logged-out) shell.
 *
 * Persona swap: fade-out, blank hold, fade-in
 * -------------------------------------------
 * Picking a new tick drives a single derived `visible` boolean
 * (`activeIndex === committedIndex`) that owns the opacity of BOTH
 * the page bg layer (rendered here) and the desktop wallpaper
 * (rendered inside `MockAuraApp` via `ComposePanel`). The swap
 * runs in four phases:
 *
 *   1. User clicks a tick. `activeIndex` flips immediately, which
 *      drives the rail's `aria-current`, the marketing nav / tick
 *      foreground vars, and the CTA glow — clicks always feel
 *      responsive. `activeIndex !== committedIndex` so `visible`
 *      drops to `false` in the same render.
 *   2. CSS opacity transitions on `.siteBackground` and the
 *      desktop bg wrapper (400ms ease-in-out) tween both surfaces
 *      from 1 → 0 in parallel. The OLD persona's color + image
 *      fade out together as one snapshot.
 *   3. The transitions finish at 400ms; the layers sit at
 *      opacity 0 for the remaining ~150ms of the `FADE_MS`
 *      window. This blank hold is what makes the swap obviously
 *      read as a clean fade-out-then-fade-in instead of one
 *      uninterrupted dissolve.
 *   4. Timer fires at 550ms. `setCommittedIndex(activeIndex)`
 *      updates the painted content AND — because `visible` is
 *      derived — flips it back to `true` in the same render. The
 *      new content lands in the DOM at opacity 0, then the CSS
 *      transition tweens opacity 0 → 1 to reveal it.
 *
 * That's it. No layered cross-fade, no decode gate, no
 * onLoad-driven state machine. The bg color + image always paint
 * as ONE element so they fade together; same for the wallpaper
 * (a single `<div>` inside `MockAuraApp` that carries both the
 * persona color and the wallpaper `<img>`).
 *
 * GPU-resident preload stash
 * --------------------------
 * Below the visible content we render one persistently-mounted
 * `<img>` per persona URL inside `.preloadStash` (offscreen at
 * 1x1px). The browser keeps each decoded bitmap warm in its image
 * cache, so when the visible bg / wallpaper layers later re-render
 * with a new src the bitmap is already paintable. Without the
 * stash a cold-cache swap can briefly paint an empty layer at the
 * moment opacity reaches 1.
 */

// Total wait between the click and committing the new persona. Holds
// the layers at opacity 0 for `FADE_MS - <css transition duration>`
// milliseconds AFTER the fade-out transition finishes so the swap
// reads as fade-out -> brief blank hold -> fade-in rather than a
// single uninterrupted dissolve. The matching CSS opacity transition
// in `PublicChatView.module.css` and `MockAuraApp.module.css` is
// 400ms, so the difference (150ms) is the visible dark pause that
// makes the swap obvious without feeling sluggish.
const FADE_MS = 550;

export function PublicChatView(): React.ReactElement {
  const navigate = useNavigate();

  const [activeIndex, setActiveIndex] = useState<number>(0);
  // The persona currently driving the painted bg + wallpaper. Lags
  // `activeIndex` by one `FADE_MS` window so the swap is always:
  // fade out (old persona at opacity 0) -> swap committed -> fade in
  // (new persona at opacity 1).
  const [committedIndex, setCommittedIndex] = useState<number>(0);

  // Opacity for the bg + wallpaper layers, derived directly from
  // whether the user-selected persona has caught up with the
  // committed render. While they diverge we're in the fade-out
  // window: the page bg wrapper + the desktop background inside
  // MockAuraApp both render at opacity 0 and the CSS transition
  // tweens from the prior frame's opacity 1 down to 0. When the
  // timer below flips committedIndex to match activeIndex, visible
  // returns to true and the transition tweens 0 -> 1 over the new
  // persona's content.
  const visible = activeIndex === committedIndex;

  const activePersona = useMemo(() => getPersonaAt(activeIndex), [activeIndex]);
  const committedPersona = useMemo(
    () => getPersonaAt(committedIndex),
    [committedIndex],
  );

  // The swap effect. Waits `FADE_MS` after the visitor picks a new
  // persona (during which the derived `visible` boolean is already
  // false, fading both surfaces out via the CSS opacity transition)
  // and then flips `committedIndex` to the new target. That single
  // setState updates the painted content AND flips `visible` back
  // to true, so the new persona's color + image render at opacity 0
  // for one frame and the CSS transition tweens them up to 1.
  //
  // Cleanup cancels the pending timer so a rapid second click
  // restarts the fade-out from whatever opacity the in-flight
  // transition reached — the next persona swap takes over cleanly
  // without ever committing the intermediate one.
  useEffect(() => {
    if (activeIndex === committedIndex) return;
    const timer = window.setTimeout(() => {
      setCommittedIndex(activeIndex);
    }, FADE_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, committedIndex]);

  // Foreground vars + CTA glow bound to the ACTIVE persona so the
  // tick click flips them instantly, matching the rail's
  // aria-current. The page bg + wallpaper bind to committedPersona
  // below so they wait their turn behind the fade.
  useEffect(() => {
    const root = document.documentElement;
    const { siteForegroundColor, siteForegroundColorMuted } = activePersona.theme;
    const apply = (name: string, value: string | null): void => {
      if (value) {
        root.style.setProperty(name, value);
      } else {
        root.style.removeProperty(name);
      }
    };
    apply("--public-nav-fg-color", siteForegroundColor);
    apply("--public-nav-fg-color-muted", siteForegroundColorMuted);
    return () => {
      root.style.removeProperty("--public-nav-fg-color");
      root.style.removeProperty("--public-nav-fg-color-muted");
    };
  }, [activePersona]);

  // Chat palette bound to the COMMITTED persona so the in-window
  // text tokens flip in the same render as the wallpaper rather
  // than racing ahead of the fade.
  const { resolvedTheme } = useTheme();
  const chatPalette = useMemo(
    () =>
      deriveChatPalette(
        committedPersona.theme.siteBackgroundColor,
        resolvedTheme,
      ),
    [committedPersona, resolvedTheme],
  );

  const chatViewStyle = useMemo<CSSProperties | undefined>(() => {
    const { siteCtaGlowColor } = activePersona.theme;
    if (!siteCtaGlowColor) return undefined;
    const style: CSSProperties & Record<"--public-cta-glow-color", string> =
      {} as CSSProperties & Record<"--public-cta-glow-color", string>;
    style["--public-cta-glow-color"] = siteCtaGlowColor;
    return style;
  }, [activePersona]);

  const siteBgStyle = useMemo<CSSProperties>(
    () => ({
      backgroundColor: committedPersona.theme.siteBackgroundColor ?? undefined,
      opacity: visible ? 1 : 0,
    }),
    [committedPersona, visible],
  );

  // GPU-resident preload list. Rendered as `<img>` siblings inside
  // `.preloadStash` so the browser keeps each bitmap warm for the
  // lifetime of the shell.
  const preloadUrls = useMemo<readonly string[]>(() => {
    const all = new Set<string>();
    for (const persona of PERSONAS) {
      const { desktopBackgroundUrl, siteBackgroundUrl } = persona.theme;
      if (desktopBackgroundUrl) all.add(desktopBackgroundUrl);
      if (siteBackgroundUrl) all.add(siteBackgroundUrl);
    }
    return Array.from(all);
  }, []);

  return (
    <div
      className={styles.chatView}
      data-persona-id={committedPersona.id}
      style={chatViewStyle}
    >
      {/*
       * Page bg layer — one element that paints both the persona's
       * `siteBackgroundColor` (on the wrapper) and its
       * `siteBackgroundUrl` (as an inner `<img>`). Both fade
       * together via `opacity` on the wrapper, so the swap reads
       * as "the whole bg dissolves" instead of "the image fades
       * while the color snaps". The wrapper always mounts so its
       * CSS opacity transition has a stable target element to
       * tween against.
       */}
      <div
        className={styles.siteBackground}
        style={siteBgStyle}
        data-testid="public-chat-site-bg"
        aria-hidden="true"
      >
        {committedPersona.theme.siteBackgroundUrl ? (
          <img
            src={committedPersona.theme.siteBackgroundUrl}
            className={styles.siteBackgroundImage}
            alt=""
            aria-hidden="true"
            draggable={false}
            decoding="sync"
            data-testid="public-chat-site-bg-image"
          />
        ) : null}
      </div>
      <div className={styles.heroSlot}>
        <ComposePanel
          desktopBackgroundUrl={committedPersona.theme.desktopBackgroundUrl}
          desktopBackgroundPosition={
            committedPersona.theme.desktopBackgroundPosition
          }
          desktopBackgroundFit={committedPersona.theme.desktopBackgroundFit}
          desktopBackgroundColor={committedPersona.theme.desktopBackgroundColor}
          desktopBackgroundScale={committedPersona.theme.desktopBackgroundScale}
          desktopBackgroundOpacity={visible ? 1 : 0}
          chatPalette={chatPalette}
        />
      </div>
      <div className={styles.tickRailSlot}>
        <PersonaTickRail
          activeIndex={activeIndex}
          onActiveIndexChange={(next) => {
            if (next < 0 || next >= PERSONAS.length) return;
            setActiveIndex(next);
          }}
        />
      </div>
      <div className={styles.ctaSlot}>
        <button
          type="button"
          className={styles.ctaButton}
          data-agent-surface="public-landing-cta"
          onClick={() => navigate("/login?tab=register")}
        >
          <span>Create your agent</span>
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.preloadStash} aria-hidden="true">
        {preloadUrls.map((url) => (
          <img
            key={url}
            src={url}
            alt=""
            aria-hidden="true"
            draggable={false}
            loading="eager"
            decoding="sync"
            data-testid="public-chat-preload-img"
          />
        ))}
      </div>
    </div>
  );
}
