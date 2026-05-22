import { useMemo, useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { ComposePanel } from "../ComposePanel";
import { PersonaTickRail } from "../PersonaTickRail";
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
 *     button is a placeholder today (no onClick / no route);
 *     wiring it to a real signup destination is a follow-up.
 *
 * Theme propagation:
 *   The active persona's `siteBackgroundColor` and
 *   `siteBackgroundUrl` are applied as inline styles on
 *   `.chatView` (color paints under the image so first-paint
 *   matches the dominant tone of the asset). When both fields are
 *   `null` for the active persona the inline style collapses to
 *   `undefined` and the shell's default page color shows through.
 */
export function PublicChatView(): React.ReactElement {
  // Index 0 (Vibecoder) is the default landing persona. Hover/
  // focus/click on a tick promotes that persona to active and the
  // selection sticks until the visitor picks another tick — there
  // is no auto-reset on mouseleave.
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const activePersona = useMemo(() => getPersonaAt(activeIndex), [activeIndex]);

  const chatViewStyle = useMemo<CSSProperties | undefined>(() => {
    const { siteBackgroundColor, siteBackgroundUrl } = activePersona.theme;
    if (!siteBackgroundColor && !siteBackgroundUrl) {
      return undefined;
    }
    const style: CSSProperties = {};
    if (siteBackgroundColor) {
      style.backgroundColor = siteBackgroundColor;
    }
    if (siteBackgroundUrl) {
      style.backgroundImage = `url("${siteBackgroundUrl}")`;
      style.backgroundSize = "cover";
      style.backgroundPosition = "center";
      style.backgroundRepeat = "no-repeat";
    }
    return style;
  }, [activePersona]);

  return (
    <div
      className={styles.chatView}
      data-persona-id={activePersona.id}
      style={chatViewStyle}
    >
      <div className={styles.heroSlot}>
        <ComposePanel
          desktopBackgroundUrl={activePersona.theme.desktopBackgroundUrl}
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
        >
          <span>Create your agent</span>
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
