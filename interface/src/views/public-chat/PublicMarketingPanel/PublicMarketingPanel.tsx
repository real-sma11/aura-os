import { Outlet } from "react-router-dom";
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
 */
export function PublicMarketingPanel(): React.ReactElement {
  return (
    <div className={styles.scrollColumn}>
      <Outlet />
    </div>
  );
}
