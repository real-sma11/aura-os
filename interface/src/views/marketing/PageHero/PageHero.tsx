import { type ReactNode } from "react";
import "./PageHero.css";

interface PageHeroProps {
  readonly label?: string;
  readonly headline: ReactNode;
  readonly description: string;
  readonly ctaText?: string;
  readonly ctaIcon?: ReactNode;
  readonly ctaHref?: string;
  readonly onCtaClick?: () => void;
  readonly preview?: ReactNode | null;
}

/**
 * Marketing page hero. Ported from
 * `aura-web/src/components/PageHero/PageHero.tsx`. The aura-web source
 * delegated the CTA to a shared `ButtonAction` component; we inline a
 * minimal anchor-button replacement here so this component stays
 * self-contained inside the marketing port.
 *
 * Consumers can render the CTA in two modes:
 *   - `ctaHref` set     -> renders as an `<a>` (external links, hashes).
 *   - `onCtaClick` only -> renders as a `<button>`.
 *
 * Today only the Product view uses this component, and it passes
 * `preview={null}` with no `ctaText`, so neither branch is currently hit
 * in production. The styles are kept ready for future marketing pages.
 */
export function PageHero({
  label,
  headline,
  description,
  ctaText,
  ctaIcon,
  ctaHref,
  onCtaClick,
  preview,
}: PageHeroProps): ReactNode {
  const pageHeroClassName =
    preview === null ? "pageHero pageHeroNoPreview" : "pageHero";

  return (
    <section className={pageHeroClassName}>
      <div className="pageHeroContent">
        {label ? <span className="pageHeroLabel">{label}</span> : null}
        <h1 className="pageHeroHeadline">{headline}</h1>
        <p className="pageHeroDescription">{description}</p>
        {ctaText ? (
          <div className="pageHeroActions">
            {ctaHref ? (
              <a
                href={ctaHref}
                className="pageHeroCtaButton"
                onClick={onCtaClick}
              >
                {ctaIcon ? (
                  <span aria-hidden="true">{ctaIcon}</span>
                ) : null}
                {ctaText}
              </a>
            ) : (
              <button
                type="button"
                className="pageHeroCtaButton"
                onClick={onCtaClick}
              >
                {ctaIcon ? (
                  <span aria-hidden="true">{ctaIcon}</span>
                ) : null}
                {ctaText}
              </button>
            )}
          </div>
        ) : null}
      </div>
      {preview !== null ? (
        <div className="pageHeroPreview">
          {preview ?? <div className="pageHeroPreviewPlaceholder" />}
        </div>
      ) : null}
    </section>
  );
}
