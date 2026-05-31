import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import styles from "./PublicTopNav.module.css";

interface TopNavLink {
  label: string;
  to: string;
}

/**
 * Primary marketing links, rendered left-to-right in the centered
 * top bar. `Resources` is not in this list — it opens the dropdown
 * below instead of navigating to a single route.
 */
const PRIMARY_LINKS: ReadonlyArray<TopNavLink> = [
  { label: "Agents", to: "/agents" },
  { label: "Code", to: "/code" },
  { label: "Pricing", to: "/pricing" },
];

/** Routes grouped under the `Resources` dropdown. */
const RESOURCE_LINKS: ReadonlyArray<TopNavLink> = [
  { label: "Changelog", to: "/changelog" },
  { label: "Feedback", to: "/feedback" },
  { label: "Models", to: "/models" },
];

/**
 * Public-mode marketing navigation, mounted in the centered title
 * slot of `AuraTitlebar` (replacing the old left-sidebar
 * `PublicSidebarFooter`). The top-left AURA logo handles "home", so
 * there is no Home link here; "Chat" lives in the bottom-left
 * taskbar. The links swap the public-mode main panel content while
 * leaving the rest of the public shell (titlebar + sidebar + this
 * nav) mounted.
 *
 * Public-only: rendered exclusively from `AuraTitlebar`'s public
 * branch so logged-in users never see the marketing nav.
 */
export function PublicTopNav(): React.ReactElement {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const resourcesActive = RESOURCE_LINKS.some(
    (link) => pathname === link.to || pathname.startsWith(`${link.to}/`),
  );

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Outside-click + Escape close the dropdown.
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointer = (event: MouseEvent): void => {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        menuRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  // Anchor the portal menu under the trigger. Measured synchronously
  // so the menu paints in the right spot on the same frame it opens.
  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 6, left: rect.left });
  }, [menuOpen]);

  const linkClassName = useCallback(
    ({ isActive }: { isActive: boolean }) =>
      `${styles.link} ${isActive ? styles.linkActive : ""}`,
    [],
  );

  return (
    <nav
      className={`${styles.nav} titlebar-no-drag`}
      aria-label="AURA public navigation"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {PRIMARY_LINKS.map((link) => (
        <NavLink key={link.label} to={link.to} className={linkClassName}>
          {link.label}
        </NavLink>
      ))}
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.link} ${styles.resourcesTrigger} ${
          resourcesActive || menuOpen ? styles.linkActive : ""
        }`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        Resources
        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Resources"
            className={styles.menu}
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {RESOURCE_LINKS.map((link) => (
              <NavLink
                key={link.label}
                to={link.to}
                role="menuitem"
                onClick={closeMenu}
                className={({ isActive }) =>
                  `${styles.menuItem} ${isActive ? styles.menuItemActive : ""}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>,
          document.body,
        )}
    </nav>
  );
}
