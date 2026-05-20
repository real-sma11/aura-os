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
  { label: "Feedback", href: `${AURA_WEBSITE}/roadmap` },
  { label: "Pricing", href: `${AURA_WEBSITE}/pricing` },
];

/**
 * Sticky footer at the bottom of `LoggedOutSessionsPanel`. Renders
 * four marketing-site links. Kept intentionally lightweight (no
 * analytics, no client routing) — the marketing host is owned by a
 * separate codebase and these links always escape SPA-land. The
 * personalization upsell card that previously sat below the links was
 * removed because the same "Log in" / "Sign up" CTA already lives in
 * the titlebar and the duplicated affordance was crowding the rail.
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
