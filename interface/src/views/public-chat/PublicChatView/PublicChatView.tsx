import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTheme } from "@cypher-asi/zui";
import { ComposePanel } from "../ComposePanel";
import { CreateAgentButton } from "../CreateAgentButton";
import { PersonaTickRail } from "../PersonaTickRail";
import { deriveChatPalette } from "../MockAuraApp/derive-chat-palette";
import { PERSONAS, getPersonaAt, type Persona } from "../personas";
import styles from "./PublicChatView.module.css";

/**
 * Right-side surface for the public (logged-out) shell.
 *
 * Persona swap: dissolve through a layered overlap
 * ------------------------------------------------
 * Picking a new tick swaps the painted persona immediately — there
 * is no delayed fade-out window. Instead the OUTGOING persona is
 * captured into a second layer that mounts ON TOP of the new
 * committed layer and fades from opacity 1 → 0 over `FADE_MS`. The
 * new layer underneath sits at full opacity the entire time, so as
 * the outgoing layer dissolves the new content is revealed beneath
 * it. The visitor sees the old persona "fade into" the new one
 * with no black hold and no parent-bg leak.
 *
 * The during-render setState below (the "Adjusting State Based on
 * Props" pattern from the React docs) is what guarantees BOTH
 * layers land in the same paint as the click. Deferring the
 * outgoing-layer mount to a `useEffect` would mean the new layer
 * paints alone for one frame before the outgoing layer mounts on
 * top, producing a visible snap-in.
 *
 * Each layer is still a SINGLE `<div>` carrying both the persona
 * color (on the wrapper) and the wallpaper / site image (as an
 * inner `<img>`), so color + image always dissolve as one
 * snapshot. Two layers stacked × one `<div>` per layer = exactly
 * the "wallpaper + image as one div" model the user asked for; the
 * layering is purely about the overlap between the OLD snapshot
 * and the NEW snapshot, not about splitting color from image.
 */

interface PersonaBgSnapshot {
  readonly persona: Persona;
  readonly fadeKey: number;
}

interface PersonaSwapState {
  readonly committedIndex: number;
  readonly outgoing: PersonaBgSnapshot | null;
  readonly nextFadeKey: number;
}

// Duration of the outgoing layer's opacity fade-out animation.
// Must match the `fadeOut` keyframe durations in
// `PublicChatView.module.css` and `MockAuraApp.module.css` so the
// React teardown timer (`FADE_MS + 50`) clears the outgoing layer
// exactly one frame after its animation lands at opacity 0.
const FADE_MS = 550;

// Cooldown between wheel-driven persona changes. One discrete scroll
// gesture (wheel notch / trackpad flick) advances exactly one
// persona; subsequent wheel events that arrive inside this window
// are ignored so a momentum trackpad can't blow through every
// persona in a single swipe. Tuned to land just above the
// `FADE_MS` cross-fade so the previous dissolve is visually
// well underway before the next one starts stacking on top.
const WHEEL_COOLDOWN_MS = 350;

// Floor on `event.deltaY` magnitude before a wheel event counts as
// a vertical scroll. Filters out near-zero noise from horizontal
// trackpad gestures that some browsers fold into `deltaY` as
// tiny sub-pixel values — without this guard a sideways two-finger
// swipe would occasionally trip a persona change.
const WHEEL_DELTA_THRESHOLD = 4;

export function PublicChatView(): React.ReactElement {
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const [swap, setSwap] = useState<PersonaSwapState>(() => ({
    committedIndex: 0,
    outgoing: null,
    nextFadeKey: 1,
  }));

  // Detect a persona change during render and capture the outgoing
  // snapshot in the same paint as the new committed index. The
  // `if` guard guarantees the setter only runs when activeIndex
  // diverges from the committed index, so this can't loop.
  if (swap.committedIndex !== activeIndex) {
    setSwap((prev) => ({
      committedIndex: activeIndex,
      outgoing: {
        persona: getPersonaAt(prev.committedIndex),
        fadeKey: prev.nextFadeKey,
      },
      nextFadeKey: prev.nextFadeKey + 1,
    }));
  }

  // Tear the outgoing layer down a frame after its fade-out
  // animation completes. The closure captures the fadeKey for
  // THIS swap so a rapid second click that mounts a NEWER outgoing
  // layer never gets cleared by a stale timer.
  const outgoingFadeKey = swap.outgoing?.fadeKey;
  useEffect(() => {
    if (outgoingFadeKey == null) return;
    const timer = window.setTimeout(() => {
      setSwap((prev) =>
        prev.outgoing?.fadeKey === outgoingFadeKey
          ? { ...prev, outgoing: null }
          : prev,
      );
    }, FADE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [outgoingFadeKey]);

  const activePersona = useMemo(() => getPersonaAt(activeIndex), [activeIndex]);
  const committedPersona = useMemo(
    () => getPersonaAt(swap.committedIndex),
    [swap.committedIndex],
  );
  const outgoingPersona = swap.outgoing?.persona ?? null;

  // Single ingress for persona swaps. Both the right-edge
  // `PersonaTickRail` and the bottom-left avatar dock inside
  // `MockAuraApp` call this with their selected index so the two
  // surfaces share one piece of state — clicking the rail updates
  // the dock's border, and clicking a dock avatar updates the
  // rail's aria-current. The in-bounds guard mirrors what the rail
  // callback previously inlined; nothing else should ever pass an
  // out-of-range index, but the guard is cheap insurance against a
  // future caller drifting from the contract.
  const handleActiveIndexChange = useCallback((next: number): void => {
    if (next < 0 || next >= PERSONAS.length) return;
    setActiveIndex(next);
  }, []);

  // Wheel-driven persona cycling. Scrolling down on the landing
  // surface advances to the next persona (one further down the
  // tick rail) and scrolling up rewinds to the previous one,
  // wrapping past either end so the list reads as an infinite
  // carousel rather than a clamped slider. The cooldown ref holds
  // the wall-clock timestamp of the most recent accepted wheel
  // event so a momentum trackpad gesture (which fires many wheel
  // events per flick) advances exactly one persona instead of
  // racing through the whole list. The ref deliberately bypasses
  // state so the per-frame wheel event stream doesn't trigger a
  // re-render — only the eventual `setActiveIndex` call does.
  //
  // Sentinel is `-Infinity` (not 0) so the very first wheel event
  // always passes the cooldown gate. With `performance.now()`
  // starting near 0 on a fresh mount — or exactly 0 under
  // Vitest's fake timers — a 0-initialized ref would mean
  // `0 - 0 === 0 < WHEEL_COOLDOWN_MS` and silently swallow the
  // first wheel event.
  const lastWheelTriggerRef = useRef<number>(Number.NEGATIVE_INFINITY);

  const handleWheelCycle = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>): void => {
      const delta = event.deltaY;
      if (Math.abs(delta) < WHEEL_DELTA_THRESHOLD) return;
      const now =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      if (now - lastWheelTriggerRef.current < WHEEL_COOLDOWN_MS) return;
      lastWheelTriggerRef.current = now;

      const direction = delta > 0 ? 1 : -1;
      const n = PERSONAS.length;
      // Double-mod to normalize negative results into the [0, n)
      // range; a single `%` in JS preserves sign so `-1 % 6 === -1`
      // would otherwise round-trip into the clamp guard below.
      setActiveIndex((prev) => ((prev + direction) % n + n) % n);
    },
    [],
  );

  // Foreground vars + CTA glow bound to the ACTIVE persona so the
  // tick click flips them instantly, matching the rail's
  // aria-current. The page bg + wallpaper bind to committedPersona
  // (= activeIndex's persona by the end of the render) but the
  // overlay layer carries the OLD persona while it fades.
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
  // text tokens flip in the same render as the wallpaper.
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

  const committedSiteBgStyle: CSSProperties = {
    backgroundColor: committedPersona.theme.siteBackgroundColor ?? undefined,
  };
  const outgoingSiteBgStyle: CSSProperties | null = outgoingPersona
    ? {
        backgroundColor: outgoingPersona.theme.siteBackgroundColor ?? undefined,
      }
    : null;

  return (
    <div
      className={styles.chatView}
      data-persona-id={committedPersona.id}
      data-testid="public-chat-view"
      style={chatViewStyle}
      onWheel={handleWheelCycle}
    >
      {/*
       * Current page bg layer — paints the new persona's color +
       * image at full opacity, no animation. The outgoing layer
       * below (when present) sits on top of this with a fade-out
       * animation so as the outgoing pixels disappear, these new
       * pixels are revealed beneath them — the "fade into one
       * another" effect with no dark midpoint.
       */}
      <div
        className={styles.siteBackground}
        style={committedSiteBgStyle}
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
      {outgoingPersona && outgoingSiteBgStyle ? (
        <div
          key={`site-bg-out-${swap.outgoing?.fadeKey}`}
          className={`${styles.siteBackground} ${styles.siteBackgroundLeaving}`}
          style={outgoingSiteBgStyle}
          data-testid="public-chat-site-bg-outgoing"
          aria-hidden="true"
        >
          {outgoingPersona.theme.siteBackgroundUrl ? (
            <img
              src={outgoingPersona.theme.siteBackgroundUrl}
              className={styles.siteBackgroundImage}
              alt=""
              aria-hidden="true"
              draggable={false}
              decoding="sync"
            />
          ) : null}
        </div>
      ) : null}
      <div className={styles.heroSlot}>
        <ComposePanel
          desktopBackgroundUrl={committedPersona.theme.desktopBackgroundUrl}
          desktopBackgroundPosition={
            committedPersona.theme.desktopBackgroundPosition
          }
          desktopBackgroundFit={committedPersona.theme.desktopBackgroundFit}
          desktopBackgroundColor={committedPersona.theme.desktopBackgroundColor}
          desktopBackgroundScale={committedPersona.theme.desktopBackgroundScale}
          outgoingDesktopBackground={
            outgoingPersona && swap.outgoing
              ? {
                  url: outgoingPersona.theme.desktopBackgroundUrl,
                  position: outgoingPersona.theme.desktopBackgroundPosition,
                  fit: outgoingPersona.theme.desktopBackgroundFit,
                  color: outgoingPersona.theme.desktopBackgroundColor,
                  scale: outgoingPersona.theme.desktopBackgroundScale,
                  fadeKey: swap.outgoing.fadeKey,
                }
              : null
          }
          chatPalette={chatPalette}
          activePersonaIndex={activeIndex}
          onPersonaSelect={handleActiveIndexChange}
        />
      </div>
      <div className={styles.tickRailSlot}>
        <PersonaTickRail
          activeIndex={activeIndex}
          onActiveIndexChange={handleActiveIndexChange}
        />
      </div>
      <div className={styles.ctaSlot}>
        <CreateAgentButton />
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
