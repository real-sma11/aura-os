import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@cypher-asi/zui";
import { ArrowRight } from "lucide-react";
import { ComposePanel } from "../ComposePanel";
import { PersonaTickRail } from "../PersonaTickRail";
import { deriveChatPalette } from "../MockAuraApp/derive-chat-palette";
import { PERSONAS, getPersonaAt } from "../personas";
import styles from "./PublicChatView.module.css";

/**
 * Right-side surface for the public (logged-out) shell. As of the
 * landing-CTA refactor this is a pure marketing landing — there is
 * no chat input, transcript, gate modal, or per-session state. The
 * view also owns the per-persona theme swap: the right-rail
 * `PersonaTickRail` is rendered as a controlled component, the
 * active index drives both the wallpaper inside `MockAuraApp` and
 * the page-level site background painted on `.chatView`.
 *
 * Layout:
 *   - An optional full-bleed `<video>` layer is mounted as the
 *     FIRST child of `.chatView` when the active persona supplies
 *     a `siteBackgroundVideoUrl` — paints behind every slot below
 *     so the looping motion frames the mock desktop window the
 *     way the desktop frames the orb on the default Vibecoder
 *     landing.
 *   - `.heroSlot` fills the available area and mounts `ComposePanel`,
 *     which centers the decorative `MockAuraApp` (a flat 16:10
 *     rectangle with scripted DM windows floating inside) and
 *     paints the active persona's `desktopBackgroundUrl` as the
 *     wallpaper (falling back to `/AURA_visual_loop.mp4` when the
 *     active theme leaves it `null`).
 *   - `.tickRailSlot` pins the `PersonaTickRail` to the far-right
 *     edge of the surface and vertically centers it next to the
 *     hero.
 *   - `.ctaSlot` floats at `bottom: 5vh` and mounts a single
 *     horizontally-centered "Create your agent" pill button. The
 *     button is styled as a neon-glow panel: dark translucent fill
 *     with a colored bloom whose hue is driven by the active
 *     persona's `siteCtaGlowColor` (published below as
 *     `--public-cta-glow-color` on `.chatView`). Clicking it
 *     navigates to `/login?tab=register`, which `AuraShell` overlays
 *     as the `LoginOverlay` modal with the Create Account tab
 *     pre-selected — the same destination the marketing nav's
 *     "Sign Up" pill uses.
 *
 * Theme propagation:
 *   The active persona's `siteBackgroundColor` and
 *   `siteBackgroundUrl` are applied as inline styles on
 *   `.chatView` (color paints under the image so first-paint
 *   matches the dominant tone of the asset). When the persona
 *   supplies a `siteBackgroundVideoUrl` instead, a dedicated
 *   `<video>` layer is mounted as the FIRST child of `.chatView`
 *   so it paints beneath the hero / CTA / tick rail (z-index
 *   layering lives in `PublicChatView.module.css`); the inline
 *   image bg is suppressed in that case so the two layers never
 *   stack. When every site-bg field is `null` for the active
 *   persona the inline style collapses to `undefined` and the
 *   shell's default page color shows through.
 */
export function PublicChatView(): React.ReactElement {
  const navigate = useNavigate();

  // Index 0 (Vibecoder) is the default landing persona. Hover/
  // focus/click on a tick promotes that persona to active and the
  // selection sticks until the visitor picks another tick — there
  // is no auto-reset on mouseleave.
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const activePersona = useMemo(() => getPersonaAt(activeIndex), [activeIndex]);

  // The marketing footer in `PublicSidebarFooter` lives inside
  // `AuraSidebar` — a sibling of `PublicChatView`, not a descendant
  // — so the active persona's foreground colors are bridged through
  // `document.documentElement` as CSS custom properties. The right-
  // edge `PersonaTickRail` (a child of this view) also reads the
  // same properties so the rail and the marketing footer stay in
  // visual sync across persona swaps. Cleanup on unmount/persona
  // change keeps the variables from leaking into authed shells where
  // neither surface mounts.
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
  // the global `hljs-*` tokens). Pure helper, runs synchronously on
  // every persona swap; returns `null` for `NO_THEME` personas so
  // the shell's default tokens keep painting. The result is passed
  // through `ComposePanel` to `MockAuraApp`, which spreads it onto
  // `.appFrame` as `--mock-*` custom properties — see
  // `derive-chat-palette.ts` and `MockAuraApp.module.css`'s
  // `[data-persona-themed="true"]` block.
  //
  // `resolvedTheme` decides the contrast direction (the DM bubbles
  // fill from `--color-surface` which tracks the theme, not the
  // wallpaper). Recomputing on theme change keeps the chat readable
  // when the user flips light/dark while a persona is active —
  // mirrors how `HighlightThemeBridge` reacts to the same hook.
  const { resolvedTheme } = useTheme();
  const chatPalette = useMemo(
    () =>
      deriveChatPalette(
        activePersona.theme.siteBackgroundColor,
        resolvedTheme,
      ),
    [activePersona, resolvedTheme],
  );

  const chatViewStyle = useMemo<CSSProperties | undefined>(() => {
    const {
      siteBackgroundColor,
      siteBackgroundUrl,
      siteBackgroundVideoUrl,
      siteCtaGlowColor,
    } = activePersona.theme;
    if (
      !siteBackgroundColor &&
      !siteBackgroundUrl &&
      !siteBackgroundVideoUrl &&
      !siteCtaGlowColor
    ) {
      return undefined;
    }
    // Extend the standard CSSProperties record with the one custom
    // property we publish on this element. Cast through `Record` so
    // the literal `--public-cta-glow-color` survives the type check
    // without widening the overall style to `any`.
    const style: CSSProperties & Record<"--public-cta-glow-color", string> =
      {} as CSSProperties & Record<"--public-cta-glow-color", string>;
    if (siteBackgroundColor) {
      style.backgroundColor = siteBackgroundColor;
    }
    // The video bg (rendered as a separate `<video>` layer below)
    // takes precedence over the static image bg — if a persona
    // sets both, the video wins and the image is ignored so the
    // two layers never paint stacked.
    if (siteBackgroundUrl && !siteBackgroundVideoUrl) {
      style.backgroundImage = `url("${siteBackgroundUrl}")`;
      style.backgroundSize = "cover";
      style.backgroundPosition = "center";
      style.backgroundRepeat = "no-repeat";
    }
    // Scope the CTA accent variable to this view — the glow is the
    // only consumer, so there's no reason to leak it onto
    // `documentElement` like the nav/tick foreground tokens. CSS
    // falls back to the neon-violet default in `.ctaButton` when
    // the active persona leaves this field `null`.
    if (siteCtaGlowColor) {
      style["--public-cta-glow-color"] = siteCtaGlowColor;
    }
    return style;
  }, [activePersona]);

  return (
    <div
      className={styles.chatView}
      data-persona-id={activePersona.id}
      style={chatViewStyle}
    >
      {activePersona.theme.siteBackgroundVideoUrl ? (
        /*
         * Looping site-background video. Sits BEHIND every other
         * slot (`.heroSlot`, `.ctaSlot`, `.tickRailSlot`) via the
         * z-index ordering in `PublicChatView.module.css`. `key` is
         * the URL so React fully remounts the element when the
         * active persona swaps to a different video — otherwise
         * React would reuse the same `<video>` node and the new
         * `src` would not always start the loop fresh. The
         * `aria-hidden` + decorative attributes keep this layer
         * out of the assistive-tech tree.
         */
        <video
          key={activePersona.theme.siteBackgroundVideoUrl}
          className={styles.siteBackgroundVideo}
          src={activePersona.theme.siteBackgroundVideoUrl}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          data-testid="public-chat-site-bg-video"
        />
      ) : null}
      <div className={styles.heroSlot}>
        <ComposePanel
          desktopBackgroundUrl={activePersona.theme.desktopBackgroundUrl}
          desktopBackgroundPosition={
            activePersona.theme.desktopBackgroundPosition
          }
          desktopBackgroundFit={activePersona.theme.desktopBackgroundFit}
          desktopBackgroundColor={activePersona.theme.desktopBackgroundColor}
          desktopBackgroundScale={activePersona.theme.desktopBackgroundScale}
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
