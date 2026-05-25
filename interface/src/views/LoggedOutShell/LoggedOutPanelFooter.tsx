import styles from "./LoggedOutShell.module.css";

const AURA_WEBSITE = "https://aura.ai";

interface FooterLink {
  label: string;
  href: string;
}

const FOOTER_LINKS: FooterLink[] = [
  { label: "Product", href: `${AURA_WEBSITE}/product` },
  { label: "Changelog", href: `${AURA_WEBSITE}/changelog` },
  { label: "Feedback", href: `${AURA_WEBSITE}/roadmap` },
  { label: "Pricing", href: `${AURA_WEBSITE}/pricing` },
  { label: "Download", href: `${AURA_WEBSITE}/download` },
];

/**
 * Sticky footer at the bottom of `LoggedOutSessionsPanel`. Renders
 * four marketing-site links that open in the system browser. External
 * links are required for desktop app parity (React Router navigation
 * doesn't work in the native shell for marketing pages).
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
    </div>
  );
}
