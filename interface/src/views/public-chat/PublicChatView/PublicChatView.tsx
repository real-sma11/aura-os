import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@cypher-asi/zui";
import { ArrowRight } from "lucide-react";
import { ComposePanel } from "../ComposePanel";
import { PersonaTickRail } from "../PersonaTickRail";
import { deriveChatPalette } from "../MockAuraApp/derive-chat-palette";
import { PERSONAS, getPersonaAt } from "../personas";
import { useCrossFadeLayers } from "../cross-fade";
import { useDecodedPersonaIndex } from "../persona-preload";
import crossFadeStyles from "../cross-fade.module.css";
import styles from "./PublicChatView.module.css";

/**
 * Right-side surface for the public (logged-out) shell. As of the
 * landing-CTA refactor this is a pure marketing landing — there is
 * no chat input, transcript, gate modal, or per-session state. The
 * view owns the per-persona theme swap: the right-rail
 * `PersonaTickRail` is rendered as a controlled component, the
 * active index drives both the wallpaper inside `MockAuraApp` and
 * the page-level site background painted on `.chatView`.
 *
 * Two-tier persona state
 * ----------------------
 * The visitor's tick selection drives `activeIndex`, which commits
 * IMMEDIATELY so the rail's `aria-current`, the marketing nav / tick
 * foreground variables, the CTA glow, and the mock window's
 * text/syntax palette all flip on the same frame as the click —
 * clicks always feel responsive. The bg/wallpaper layers, however,
 * read from `committedIndex`: a separate state advanced by
 * `useDecodedPersonaIndex` that holds the swap until the new
 * persona's `desktop.png` + `site.png` are decoded. Without the
 * gate the page bg `<img>` and the wallpaper `<img>` would mount in
 * the same render but pop in at different moments depending on
 * which finished its network fetch first; with it both images are
 * paint-ready before either layer starts to fade in.
 *
 * Layered backgrounds
 * -------------------
 * `.chatView` no longer carries an inline `background-image` — that
 * would snap on every swap because `background-image` can't tween.
 * Instead two `<div className={styles.siteBackground}>` layers sit
 * absolutely behind every slot:
 *   - The outgoing snapshot (from the previous committed persona)
 *     plays `.layerLeaving` and unmounts after the fade.
 *   - The current snapshot plays `.layerEntering`.
 * The `useCrossFadeLayers` hook owns the lifecycle. The same hook
 * drives the wallpaper cross-fade inside `MockAuraApp`, so the two
 * surfaces always dissolve in lockstep.
 *
 * Layout slots
 * ------------
 * `.heroSlot` fills the available area and mounts `ComposePanel`,
 *   which centers the decorative `MockAuraApp` and paints the
 *   committed persona's `desktopBackgroundUrl` as the wallpaper.
 * `.tickRailSlot` pins the `PersonaTickRail` to the far-right
 *   edge of the surface and vertically centers it next to the
 *   hero.
 * `.ctaSlot` floats at `bottom: 5vh` and mounts a single
 *   horizontally-centered "Create your agent" pill button. The
 *   button's hue is driven by the active persona's `siteCtaGlowColor`
 *   (published below as `--public-cta-glow-color` on `.chatView`).
 *   Clicking it navigates to `/login?tab=register`.
 */

/**
 * Frozen snapshot of the site bg fields for one persona. The
 * cross-fade hook keeps two of these alive during a swap — one
 * outgoing, one entering — so the image+color paint together as a
 * single visual snapshot rather than tweening field-by-field.
 */
interface SiteBgSnapshot {
  readonly color: string | null;
  readonly url: string | null;
}

function siteBgStyle(snapshot: SiteBgSnapshot): CSSProperties | undefined {
  if (!snapshot.color && !snapshot.url) return undefined;
  const style: CSSProperties = {};
  if (snapshot.color) style.backgroundColor = snapshot.color;
  if (snapshot.url) style.backgroundImage = `url("${snapshot.url}")`;
  return style;
}

export function PublicChatView(): React.ReactElement {
  const navigate = useNavigate();

  // Index 0 (Vibecoder) is the default landing persona. Hover/focus/
  // click on a tick promotes that persona to active and the
  // selection sticks until the visitor picks another tick — there
  // is no auto-reset on mouseleave.
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const activePersona = useMemo(() => getPersonaAt(activeIndex), [activeIndex]);

  // Decode-gated commit. The visible bg + wallpaper read from this
  // index, not from `activeIndex`, so the two image layers never
  // start fading in until both `desktop.png` + `site.png` have
  // decoded. See `persona-preload.ts` for the gating + monotonic
  // token logic that protects against rapid swap races.
  const committedIndex = useDecodedPersonaIndex(activeIndex);
  const committedPersona = useMemo(
    () => getPersonaAt(committedIndex),
    [committedIndex],
  );

  // The marketing footer in `PublicSidebarFooter` lives inside
  // `AuraSidebar` — a sibling of `PublicChatView`, not a descendant
  // — so the active persona's foreground colors are bridged through
  // `document.documentElement` as CSS custom properties. The right-
  // edge `PersonaTickRail` (a child of this view) also reads the
  // same properties so the rail and the marketing footer stay in
  // visual sync. Bound to `activePersona` (not committed) so the
  // footer/rail flip the same instant the visitor clicks a tick.
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

  // Derive the per-persona text + syntax palette consumed by every
  // piece of text inside the `MockAuraApp` frame (bubble bodies,
  // agent labels, tool target/preview, terminal stream prose, and
  // the global `hljs-*` tokens). Bound to the COMMITTED persona so
  // the in-window text colors flip in the same render as the
  // wallpaper rather than racing ahead of it.
  const { resolvedTheme } = useTheme();
  const chatPalette = useMemo(
    () =>
      deriveChatPalette(
        committedPersona.theme.siteBackgroundColor,
        resolvedTheme,
      ),
    [committedPersona, resolvedTheme],
  );

  // CTA glow color — keyed to the active (not committed) persona so
  // it flips with the click, matching the rail + footer.
  const chatViewStyle = useMemo<CSSProperties | undefined>(() => {
    const { siteCtaGlowColor } = activePersona.theme;
    if (!siteCtaGlowColor) return undefined;
    // Extend the standard CSSProperties record with the one custom
    // property we publish on this element. Cast through `Record` so
    // the literal `--public-cta-glow-color` survives the type check
    // without widening the overall style to `any`.
    const style: CSSProperties & Record<"--public-cta-glow-color", string> =
      {} as CSSProperties & Record<"--public-cta-glow-color", string>;
    style["--public-cta-glow-color"] = siteCtaGlowColor;
    return style;
  }, [activePersona]);

  const siteBgSnapshot: SiteBgSnapshot = {
    color: committedPersona.theme.siteBackgroundColor,
    url: committedPersona.theme.siteBackgroundUrl,
  };
  const { outgoing: outgoingSiteBg, current: currentSiteBg } =
    useCrossFadeLayers(siteBgSnapshot, committedPersona.id);

  return (
    <div
      className={styles.chatView}
      data-persona-id={committedPersona.id}
      style={chatViewStyle}
    >
      {/*
       * Page-level site background, painted as stacked absolutely-
       * positioned layers BEHIND every slot below. Splitting the bg
       * into outgoing + entering layers is what lets the swap
       * cross-fade — `background-image` itself can't tween, but
       * two stacked layers animating opacity dissolve cleanly.
       * Both layers render only when their snapshot has actual
       * content; an all-null snapshot collapses to nothing so the
       * shell's default page color shows through.
       */}
      {outgoingSiteBg && siteBgStyle(outgoingSiteBg) ? (
        <div
          key={`site-bg-out-${outgoingSiteBg.__crossFadeId}`}
          className={`${styles.siteBackground} ${crossFadeStyles.layerLeaving}`}
          style={siteBgStyle(outgoingSiteBg)}
          data-testid="public-chat-site-bg-outgoing"
          aria-hidden="true"
        />
      ) : null}
      {siteBgStyle(currentSiteBg) ? (
        <div
          key={`site-bg-in-${committedPersona.id}`}
          className={`${styles.siteBackground} ${crossFadeStyles.layerEntering}`}
          style={siteBgStyle(currentSiteBg)}
          data-testid="public-chat-site-bg"
          aria-hidden="true"
        />
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
          chatPalette={chatPalette}
        />
      </div>
      <div className={styles.tickRailSlot}>
        <PersonaTickRail
          activeIndex={activeIndex}
          onActiveIndexChange={(next) => {
            // Clamp defensively so a future tick-rail bug can never
            // push us out of bounds and crash the lookup below.
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
    </div>
  );
}
