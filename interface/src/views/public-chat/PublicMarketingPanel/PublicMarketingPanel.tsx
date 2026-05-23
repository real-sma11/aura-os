import { Outlet, useLocation } from "react-router-dom";
import styles from "./PublicMarketingPanel.module.css";

/**
 * Layout route that mounts inside `AuraShell`'s `<main>` outlet for
 * the four public marketing pages (`/product`, `/changelog`,
 * `/feedback`, `/pricing`). It wraps the per-page `<Outlet />` in a
 * scrollable column because `AuraShell.mainPanel` is locked to
 * `overflow: hidden` and the marketing views (e.g. `ChangelogView`,
 * `PricingView`) emit long vertical sections that expect their
 * container to scroll.
 *
 * Replaces the old standalone `MarketingShell` (its own dark-themed
 * `MarketingNavbar` + `MarketingFooter` wrapper) so the marketing
 * pages render under the same public-mode chrome — `ShellTitlebar`,
 * `AuraSidebar`, and `PublicSidebarFooter` — as the public chat
 * landing surface. The persona tick rail and "Create your agent"
 * CTA disappear automatically because they live inside
 * `PublicChatView`, which only mounts on the chat / landing routes.
 *
 * Also owns the decorative gradient ring overlaid on the visible
 * scroll-column box. The ring lives at this layout level — instead
 * of inside the per-route view — so it stays mounted across route
 * changes and can play a CSS opacity fade-in when the user
 * navigates INTO `/product` and a fade-out when they leave. Moving
 * the ring into `ProductView` would unmount it the instant the
 * router swaps the Outlet, cutting any exit animation off mid-
 * frame. The visibility toggle is just a class flip driven by
 * `useLocation()`; the actual transition lives on `.gradientFrame`
 * in the companion CSS module.
 */
export function PublicMarketingPanel(): React.ReactElement {
  const { pathname } = useLocation();
  const isProductRoute =
    pathname === "/product" || pathname.startsWith("/product/");

  const gradientFrameClassName = isProductRoute
    ? `${styles.gradientFrame} ${styles.gradientFrameActive}`
    : styles.gradientFrame;

  return (
    <div className={styles.scrollColumn}>
      <Outlet />
      <div aria-hidden="true" className={gradientFrameClassName} />
    </div>
  );
}
