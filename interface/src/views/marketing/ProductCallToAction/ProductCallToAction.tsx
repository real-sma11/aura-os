import { Link } from "react-router-dom";
import "./ProductCallToAction.css";

type ProductCallToActionProps = {
  readonly href: string;
  readonly label: string;
};

/**
 * Ported from `aura-web/src/components/ProductCallToAction/ProductCallToAction.tsx`.
 * Renders the looping AURA visual behind a single CTA pill. The `AppLink`
 * Next-aware wrapper from the source is replaced with React Router's
 * `Link` since this surface is in-app only.
 */
export function ProductCallToAction({
  href,
  label,
}: ProductCallToActionProps): React.ReactNode {
  return (
    <section
      className="productCtaSection"
      aria-label="Product call to action"
    >
      <div className="productCtaPanel">
        <video
          className="productCtaVideo"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        >
          <source src="/AURA_visual_loop.mp4" type="video/mp4" />
        </video>
        <Link to={href} className="productCtaButton">
          {label}
        </Link>
      </div>
    </section>
  );
}
