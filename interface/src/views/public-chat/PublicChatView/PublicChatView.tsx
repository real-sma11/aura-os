import { ArrowRight } from "lucide-react";
import { ComposePanel } from "../ComposePanel";
import { PersonaTickRail } from "../PersonaTickRail";
import styles from "./PublicChatView.module.css";

/**
 * Right-side surface for the public (logged-out) shell. As of the
 * landing-CTA refactor this is a pure marketing landing — there is no
 * chat input, transcript, gate modal, or per-session state anymore.
 *
 * Layout:
 *   - `.heroSlot` fills the available area and mounts `ComposePanel`,
 *     which centers the decorative `MockAuraApp` (a flat 16:10 wallpaper
 *     rectangle with scripted DM windows floating inside).
 *   - `.ctaSlot` floats at the same `bottom: 5vh` anchor the old input
 *     pill used to occupy and mounts a single horizontally-centered
 *     "Create your agent" pill button. The button is a placeholder
 *     today (no onClick / no route); wiring it to a real signup
 *     destination is a follow-up.
 */
export function PublicChatView(): React.ReactElement {
  return (
    <div className={styles.chatView}>
      <div className={styles.heroSlot}>
        <ComposePanel />
      </div>
      <div className={styles.tickRailSlot}>
        <PersonaTickRail />
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
