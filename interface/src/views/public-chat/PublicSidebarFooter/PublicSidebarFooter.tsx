import { NavLink } from "react-router-dom";
import styles from "./PublicSidebarFooter.module.css";

interface FooterLink {
  label: string;
  to: string;
  /**
   * When `true`, the link is only marked active when the current
   * pathname matches `to` exactly (forwarded to `NavLink`'s `end`
   * prop). Required for `/` so the Home link doesn't latch on for
   * every nested route — without it, `NavLink` treats every path
   * (e.g. `/product`) as descended from `/` and flags Home active
   * everywhere.
   */
  end?: boolean;
}

const FOOTER_LINKS: ReadonlyArray<FooterLink> = [
  { label: "Home", to: "/", end: true },
  { label: "Product", to: "/product" },
  { label: "Changelog", to: "/changelog" },
  { label: "Feedback", to: "/feedback" },
  { label: "Pricing", to: "/pricing" },
];

/**
 * Sticky footer at the bottom of `PublicSessionsPanel`. Renders five
 * marketing-route links — Home (the public chat landing at `/`) plus
 * the four marketing pages — that swap the public-mode main panel
 * content for the corresponding view (`PublicChatView` for Home,
 * otherwise `ProductView` / `ChangelogView` / `FeedbackView` /
 * `PricingView`) while leaving the rest of the public shell
 * (titlebar + sidebar + this footer) mounted.
 *
 * `NavLink` drives the active highlight: when the current route
 * matches one of the targets, the matching link picks up the
 * `.footerLinkActive` class so visitors can see which page is
 * currently in the main panel. Home defaults to active because the
 * public-mode entrypoint is `/`.
 *
 * Phase 4 product rule: this footer is **public-only**. It mounts
 * exclusively inside `PublicSidebarBody` (in `AuraSidebar`) so
 * logged-in Simple and Advanced users never see the marketing nav
 * strip in the sidebar.
 */
export function PublicSidebarFooter(): React.ReactElement {
  return (
    <div className={styles.footer}>
      <nav className={styles.footerLinks} aria-label="AURA marketing">
        {FOOTER_LINKS.map((link) => (
          <NavLink
            key={link.label}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `${styles.footerLink} ${isActive ? styles.footerLinkActive : ""}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
