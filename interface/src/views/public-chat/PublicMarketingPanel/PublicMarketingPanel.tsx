import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
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
 * The page-level scroll uses the shared `OverlayScrollbar` (same
 * sleek mouseover-revealed 4px pill used by the aura-os left menu
 * and every other long scroll surface in the shell) instead of the
 * browser's default scrollbar. `.scrollColumn` hides the native
 * scrollbar and `<OverlayScrollbar>` mounts as a sibling inside the
 * positioned `.root` wrapper so the overlay track anchors to the
 * panel rectangle and never scrolls with the marketing content.
 */
export function PublicMarketingPanel(): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.scrollColumn}>
        <Outlet />
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
