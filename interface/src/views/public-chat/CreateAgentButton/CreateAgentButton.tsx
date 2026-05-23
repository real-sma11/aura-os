import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import styles from "./CreateAgentButton.module.css";

/**
 * Shared "Create your agent" CTA pill — the neon-glow registration
 * button used on every public (logged-out) marketing surface.
 *
 * Originally lived inline in `PublicChatView.tsx` as `.ctaButton`.
 * Extracted into its own component so the marketing `/product`
 * hero can mount the exact same pill underneath its headline
 * without forking the styles or duplicating the click handler.
 *
 * Theming
 * -------
 * The button reads its accent hue from the
 * `--public-cta-glow-color` custom property and falls back to the
 * default neon-violet (`#9b5cff`) when the property is unset.
 *   - On the public landing surface, `PublicChatView` publishes
 *     the active persona's `siteCtaGlowColor` on its `.chatView`
 *     wrapper, so the bloom flips with the active tick.
 *   - On the product hero (`ProductView` / `PageHero`), no value
 *     is published so the default violet paints — which matches
 *     the spec since the product page has no persona context.
 *
 * The button always navigates to `/login?tab=register`. There is
 * no `onClick` prop today because every consumer wants the same
 * destination; if a future surface needs a custom destination the
 * navigator + path can be lifted to props.
 */
export function CreateAgentButton(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={styles.ctaButton}
      data-agent-surface="public-landing-cta"
      onClick={() => navigate("/login?tab=register")}
    >
      <span>Create your agent</span>
      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
