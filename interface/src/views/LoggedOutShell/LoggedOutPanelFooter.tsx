import { Link } from "react-router-dom";
import styles from "./LoggedOutShell.module.css";

// Canonical marketing host. Mirrors the `AURA_WEBSITE` constant in
// `components/MenuBar/use-menu-actions.ts`; that constant is module-
// private so we duplicate the value here rather than touching the
// menu-bar file outside the Phase 2 scope. If marketing changes the
// host, both sites should move together.
const AURA_WEBSITE = "https://aura.ai";

interface FooterLink {
  label: string;
  href: string;
}

const FOOTER_LINKS: FooterLink[] = [
  { label: "Product", href: `${AURA_WEBSITE}/product` },
  { label: "Changelog", href: `${AURA_WEBSITE}/changelog` },
  { label: "Feedback", href: `${AURA_WEBSITE}/feedback` },
  { label: "Pricing", href: `${AURA_WEBSITE}/pricing` },
];

/**
 * Sticky footer at the bottom of `LoggedOutSessionsPanel`. Renders
 * four marketing-site links above a personalization upsell card. Kept
 * intentionally lightweight (no analytics, no client routing) — the
 * marketing host is owned by a separate codebase and these links
 * always escape SPA-land.
 */
export function LoggedOutPanelFooter() {
  return (
    <div className={styles.footer}>
      <nav className={styles.footerLinks} aria-label="AURA marketing">
        {FOOTER_LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className={styles.footerLink}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <div className={styles.upsellCard}>
        <h3 className={styles.upsellHeading}>Get responses tailored to you</h3>
        <p className={styles.upsellBody}>
          Log in to save your chats and get smarter responses.
        </p>
        <Link to="/login" className={styles.upsellPill}>
          Log in
        </Link>
      </div>
    </div>
  );
}
