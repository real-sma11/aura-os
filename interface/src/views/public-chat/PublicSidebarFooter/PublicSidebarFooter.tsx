import styles from "./PublicSidebarFooter.module.css";

const AURA_WEBSITE = "https://aura.ai";

interface FooterLink {
  label: string;
  href: string;
}

const FOOTER_LINKS: ReadonlyArray<FooterLink> = [
  { label: "Product", href: `${AURA_WEBSITE}/product` },
  { label: "Changelog", href: `${AURA_WEBSITE}/changelog` },
  { label: "Feedback", href: `${AURA_WEBSITE}/roadmap` },
  { label: "Pricing", href: `${AURA_WEBSITE}/pricing` },
];

/**
 * Sticky footer at the bottom of `PublicSessionsPanel`. Renders four
 * marketing-site links that open in the system browser. External
 * links are required for desktop app parity (React Router navigation
 * doesn't work in the native shell for marketing pages).
 *
 * Phase 4 product rule: this footer is **public-only**. It mounts
 * exclusively inside `PublicSidebarBody` (in `AuraSidebar`) so logged-
 * in Simple and Advanced users never see the marketing nav strip in
 * the sidebar.
 */
export function PublicSidebarFooter(): React.ReactElement {
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
