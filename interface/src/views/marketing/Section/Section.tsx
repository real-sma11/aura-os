import { type ReactNode } from "react";
import "./Section.css";

interface SectionProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  /**
   * When true (default), the section reserves at least one viewport
   * height (`min-height: 100dvh`) and vertically centers its inner
   * column. This matches the "roughly height of page" rhythm used by
   * the Apple-style marketing reference and lets each themed section
   * own the full first-fold of the scroll.
   *
   * Set to `false` for compact rows (e.g. a CTA strip) that should
   * collapse to their content height instead of reserving a whole
   * viewport.
   */
  readonly fullHeight?: boolean;
}

/**
 * Shared layout shell for the public marketing `/product` page.
 *
 * Owns three things and nothing else:
 *   1. Surface tint — reads `--marketing-section-bg` from the
 *      `.productView` cascade in
 *      `interface/src/views/marketing/ProductView/ProductView.module.css`,
 *      falling back to `#000` for any consumer mounted outside that
 *      wrapper.
 *   2. Vertical rhythm — `min-height: 100dvh` with the inner column
 *      flex-centered when `fullHeight` is true, so the section reads
 *      as a full page in the scroll regardless of how short its
 *      content is.
 *   3. Inner column cap — `max-width: var(--marketing-content-max-width)`
 *      so every themed section tracks the same wallpaper-width column
 *      already used by `ProductScreenSection`, `FeaturePanel`, etc.
 *
 * Every themed section composes its OWN internal layout inside
 * `children`. This component intentionally does not own a headline /
 * description / media slot — different sections want different
 * stacks (Apple-style 3-phone hero, screenshot lightbox, feature
 * grid, etc.), so we keep the shell layout-agnostic and let each
 * theme component drive the inside.
 */
export function Section({
  children,
  className,
  ariaLabel,
  ariaLabelledBy,
  fullHeight = true,
}: SectionProps): ReactNode {
  const sectionClassName = className ? `section ${className}` : "section";

  return (
    <section
      className={sectionClassName}
      data-full-height={fullHeight ? "true" : "false"}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div className="sectionInner">{children}</div>
    </section>
  );
}
