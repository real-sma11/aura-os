import { useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import styles from "./PublicMarketingPanel.module.css";

/*
 * Dark-mode `--color-text-primary` / `--color-text-secondary` hex
 * pair (sourced from `vendor/zui/src/styles/themes.css` and
 * `interface/src/styles/tokens.css`). Published on `<html>` for the
 * lifetime of this layout route so the persistent
 * `PublicSidebarFooter` nav (mounted in `AuraSidebar`, a sibling of
 * the marketing `<main>` panel) stays readable on the panel's
 * theme-invariant `#000` background — without this, a light-mode
 * visitor on `/product` would see the nav fall back to
 * `--color-text-secondary` (`#374151`) and the labels disappear
 * into the black panel.
 *
 * The sibling `PublicChatView` publishes the same vars per active
 * persona on `/`, so the two layouts hand the values off cleanly:
 * navigating from `/` -> `/product` swaps PublicChatView's persona
 * pair for this fixed dark pair, and navigating back swaps it
 * straight back. `PublicSidebarFooter` itself never unmounts, so it
 * always reads whichever pair is currently published.
 */
const MARKETING_NAV_FG_COLOR = "#e6e8eb";
const MARKETING_NAV_FG_COLOR_MUTED = "#c9c9cf";

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
 * surface. The persona tick rail and "Create your agent"
 * CTA disappear automatically because they live inside
 * `PublicChatView`, which only mounts on the chat / landing routes.
 *
 * The page-level scroll uses the shared `OverlayScrollbar` (same
 * sleek mouseover-revealed 4px pill used by the aura-os left menu
 * and every other long scroll surface in the shell) instead of the
 * browser's default scrollbar. `.scrollColumn` hides the native
 * scrollbar and `<OverlayScrollbar>` mounts as a sibling inside the
 * positioned `.root` wrapper so the overlay track anchors to the
 * panel rectangle and never scrolls with the marketing content.
 *
 * While mounted, this panel also pins `--public-nav-fg-color` and
 * `--public-nav-fg-color-muted` on `<html>` to the dark-mode hex
 * pair so the persistent `PublicSidebarFooter` nav (a sibling
 * outside this panel's subtree) stays readable on the
 * `#000` panel background regardless of the user's resolved theme.
 * `PublicChatView` publishes the same vars per persona on `/`, so
 * the two layouts hand the values off without a flash on route
 * change. See `MARKETING_NAV_FG_COLOR` constant below.
 */
export function PublicMarketingPanel(): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--public-nav-fg-color", MARKETING_NAV_FG_COLOR);
    root.style.setProperty(
      "--public-nav-fg-color-muted",
      MARKETING_NAV_FG_COLOR_MUTED,
    );
    return () => {
      root.style.removeProperty("--public-nav-fg-color");
      root.style.removeProperty("--public-nav-fg-color-muted");
    };
  }, []);

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.scrollColumn}>
        <Outlet />
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
