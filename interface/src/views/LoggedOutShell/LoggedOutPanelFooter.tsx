import { Link } from "react-router-dom";
import styles from "./LoggedOutShell.module.css";

interface FooterLink {
  label: string;
  to: string;
}

const FOOTER_LINKS: FooterLink[] = [
  { label: "Product", to: "/product" },
  { label: "Changelog", to: "/changelog" },
  { label: "Feedback", to: "/feedback" },
  { label: "Pricing", to: "/pricing" },
];

/**
 * Sticky footer at the bottom of `LoggedOutSessionsPanel`. Renders
 * four internal marketing-page links. Uses React Router `<Link>` so
 * navigation stays within the SPA (the marketing pages are ported
 * into the aura-code route tree under `MarketingShell`).
 */
export function LoggedOutPanelFooter() {
  return (
    <div className={styles.footer}>
      <nav className={styles.footerLinks} aria-label="AURA marketing">
        {FOOTER_LINKS.map((link) => (
          <Link
            key={link.label}
            to={link.to}
            className={styles.footerLink}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
