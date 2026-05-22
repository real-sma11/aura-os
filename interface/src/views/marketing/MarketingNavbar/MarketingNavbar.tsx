import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import "./MarketingNavbar.css";

const NAV_LINKS = [
  { label: "Product", href: "/product" },
  { label: "Changelog", href: "/changelog" },
  { label: "Feedback", href: "/feedback" },
  { label: "Pricing", href: "/pricing" },
] as const;

const MOBILE_NAV_ID = "site-mobile-nav";

/**
 * Marketing-surface top nav. Ported from `aura-web/src/components/Navbar`
 * with three intentional deviations:
 *
 *   - `usePathname()` -> `useLocation().pathname` so this renders inside a
 *     React Router 7 tree without a Next.js shim.
 *   - `next/link` -> `react-router-dom` `Link` for client-side nav.
 *   - The single Download CTA is replaced with the `Log In` / `Sign Up`
 *     pill pair routed to `/login`. SocialLinks is intentionally
 *     dropped here — only the footer carries the X/GitHub icons.
 *
 * The scroll-state class, body `mobileMenuOpen` toggle, and Escape-key
 * close behavior all match the source verbatim so the mobile drawer
 * animation is identical.
 */
export function MarketingNavbar(): React.ReactNode {
  const location = useLocation();
  const pathname = location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingMobileMenuClosePath, setPendingMobileMenuClosePath] = useState<
    string | null
  >(null);
  const [hasScrolled, setHasScrolled] = useState(false);

  const closeMobileMenu = useCallback((): void => {
    setPendingMobileMenuClosePath(null);
    setMobileMenuOpen(false);
  }, []);

  const closeMobileMenuAfterNavigation = useCallback((href: string): void => {
    setPendingMobileMenuClosePath(href);
  }, []);

  const toggleMobileMenu = useCallback((): void => {
    setPendingMobileMenuClosePath(null);
    setMobileMenuOpen((current) => !current);
  }, []);

  useEffect(() => {
    if (!pendingMobileMenuClosePath || pathname !== pendingMobileMenuClosePath) {
      return;
    }

    // Closing the drawer in response to a successful navigation is the
    // intended pattern from the aura-web source: clicking a mobile link
    // schedules `pendingMobileMenuClosePath`, and the drawer closes once
    // the router commits the new pathname. This is genuinely
    // "synchronize React with an external system" (the URL bar), which
    // the rule is generally happy with — the disable is here because
    // the rule can't see through the `closeMobileMenu` indirection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    closeMobileMenu();
  }, [closeMobileMenu, pathname, pendingMobileMenuClosePath]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      document.body.classList.remove("mobileMenuOpen");
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMobileMenu();
      }
    };

    document.body.classList.add("mobileMenuOpen");
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove("mobileMenuOpen");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMobileMenu, mobileMenuOpen]);

  useEffect(() => {
    const updateScrollState = (): void => {
      const scrollTop = Math.max(
        window.scrollY,
        document.documentElement.scrollTop,
        document.body.scrollTop,
      );

      setHasScrolled(scrollTop > 12);
    };

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    document.addEventListener("scroll", updateScrollState, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", updateScrollState);
      document.removeEventListener("scroll", updateScrollState, true);
    };
  }, []);

  const isLinkActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

  const headerClass = [
    "navbar",
    hasScrolled && !mobileMenuOpen ? "navbarScrolled" : "",
    mobileMenuOpen ? "navbarMenuOpen" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClass}>
      <nav className="navbarInner" aria-label="Primary">
        <Link to="/" className="logoLink">
          <img
            src="/AURA_logo_text_mark.png"
            alt="AURA"
            draggable={false}
            data-aura-wordmark
            className="titleLogo"
          />
        </Link>
        <ul className="navLinks">
          {NAV_LINKS.map(({ label, href }) => {
            const isActive = isLinkActive(href);
            return (
              <li key={label}>
                <Link
                  to={href}
                  className={`navLink ${isActive ? "navLinkActive" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="navActions">
          <Link to="/login" className="navAuthLink navAuthLinkSecondary">
            Log In
          </Link>
          <Link
            to="/login?tab=register"
            className="navAuthLink navAuthLinkPrimary"
          >
            Sign Up
          </Link>
          <button
            type="button"
            className="mobileMenuToggle"
            aria-expanded={mobileMenuOpen}
            aria-controls={MOBILE_NAV_ID}
            aria-label={
              mobileMenuOpen ? "Close site navigation" : "Open site navigation"
            }
            onClick={toggleMobileMenu}
          >
            {mobileMenuOpen ? (
              <X size={18} strokeWidth={1.8} />
            ) : (
              <Menu size={18} strokeWidth={1.8} />
            )}
          </button>
        </div>
      </nav>
      <div
        id={MOBILE_NAV_ID}
        className={`mobileNavPanel ${mobileMenuOpen ? "mobileNavPanelOpen" : ""}`}
        aria-hidden={!mobileMenuOpen}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="mobileNavClose"
          aria-label="Close navigation"
          onClick={closeMobileMenu}
        >
          <X size={20} strokeWidth={1.8} />
        </button>
        <div className="mobileNavPanelInner">
          <Link
            to="/login"
            className="mobileNavLink"
            onClick={() => closeMobileMenuAfterNavigation("/login")}
          >
            Log In
          </Link>
          <Link
            to="/login?tab=register"
            className="mobileNavLink"
            onClick={() => closeMobileMenuAfterNavigation("/login")}
          >
            Sign Up
          </Link>
          {NAV_LINKS.map(({ label, href }) => {
            const isActive = isLinkActive(href);
            return (
              <Link
                key={label}
                to={href}
                className={`mobileNavLink ${isActive ? "mobileNavLinkActive" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => closeMobileMenuAfterNavigation(href)}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
