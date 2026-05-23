import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import styles from "./CreateAgentButton.module.css";

interface CreateAgentButtonProps {
  /**
   * Optional consumer-supplied class appended to the base
   * `.ctaButton` rule. Lets a surface (e.g. the marketing
   * `/product` hero) layer per-location overrides — different
   * fill, text color, border treatment — without forking the
   * shared component or mutating the landing-surface baseline.
   *
   * Override rules should use a doubled-class selector
   * (`.myOverride.myOverride { ... }`) so they beat the base
   * `.ctaButton` specificity regardless of stylesheet import
   * order. The base styles deliberately keep specificity at
   * `(0,1,0)` so overrides only need `(0,2,0)` to win.
   */
  readonly className?: string;
}

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
 * Per-surface chrome (background fill, text color, etc.) can be
 * layered via the optional `className` prop — see its JSDoc.
 *
 * The button always navigates to `/login?tab=register`. There is
 * no `onClick` prop today because every consumer wants the same
 * destination; if a future surface needs a custom destination the
 * navigator + path can be lifted to props.
 */
export function CreateAgentButton({
  className,
}: CreateAgentButtonProps = {}): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const buttonClassName = className
    ? `${styles.ctaButton} ${className}`
    : styles.ctaButton;
  return (
    <button
      type="button"
      className={buttonClassName}
      data-agent-surface="public-landing-cta"
      // Stash the current location as `state.backgroundLocation`
      // so `AppRoutes` keeps the underlying surface (Product /
      // Pricing / Changelog / Feedback / chat landing) mounted
      // while `AuraShell` overlays the `LoginOverlay` on top.
      // Without this state the marketing page would unmount and
      // `PublicChatView` would flash in behind the modal.
      onClick={() =>
        navigate("/login?tab=register", {
          state: { backgroundLocation: location },
        })
      }
    >
      <span className={styles.ctaLabel}>Create your agent</span>
      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
