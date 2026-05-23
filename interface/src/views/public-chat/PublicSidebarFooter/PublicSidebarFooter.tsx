import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  { label: "Chat", to: "/chat" },
];

/**
 * Mirrors React Router's `NavLink` active-matching rule so the
 * sliding pill stays in lockstep with whichever NavLink picked up
 * the `.footerLinkActive` class. `end: true` means the pathname
 * must equal `to` exactly (used for Home so it doesn't latch on
 * every nested public route); otherwise we accept the pathname
 * equaling `to` or starting with `to + "/"` so a hypothetical
 * `/changelog/v2` would still keep the Changelog row selected
 * (matching `NavLink`'s default segment-prefix behavior).
 */
function isLinkActive(link: FooterLink, pathname: string): boolean {
  if (link.end === true) {
    return pathname === link.to;
  }
  return pathname === link.to || pathname.startsWith(`${link.to}/`);
}

/**
 * Sticky footer at the bottom of `PublicSessionsPanel`. Renders the
 * public sidebar links — Home, Product, Changelog, Feedback, Pricing,
 * and Chat — that swap the public-mode main panel content while
 * leaving the rest of the public shell (titlebar + sidebar + this
 * footer) mounted.
 *
 * `NavLink` drives the active highlight: when the current route
 * matches one of the targets, the matching link picks up the
 * `.footerLinkActive` class so visitors can see which page is
 * currently in the main panel. Home defaults to active because the
 * public-mode entrypoint is `/`.
 *
 * Phase 4 product rule: this footer is **public-only**. It mounts
 * exclusively inside `PublicSidebarBody` (in `AuraSidebar`) so
 * logged-in Simple and Advanced users never see the public nav
 * strip in the sidebar.
 */
export function PublicSidebarFooter(): React.ReactElement {
  const { pathname } = useLocation();
  /*
   * One ref slot per FOOTER_LINKS entry, populated via NavLink's
   * forwarded ref so we can measure each row's `offsetTop` /
   * `offsetHeight` after layout. The array is created once on mount
   * and reused across renders — React clears stale refs by passing
   * `null` to the callback when an element unmounts, so we never
   * read a detached node.
   */
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  /*
   * Geometry for the single sliding pill that paints behind the
   * active row. `top` + `height` are written from a layout effect
   * after measuring the active link; `visible` flips off whenever
   * no link matches the current route (e.g. the footer is mounted
   * over a non-marketing path) so the pill fades out in place
   * instead of stranding on a stale row.
   */
  const [pill, setPill] = useState<{
    top: number;
    height: number;
    visible: boolean;
  }>({ top: 0, height: 0, visible: false });

  const activeIndex = useMemo(
    () => FOOTER_LINKS.findIndex((link) => isLinkActive(link, pathname)),
    [pathname],
  );

  useLayoutEffect(() => {
    const update = (): void => {
      if (activeIndex < 0) {
        setPill((prev) => ({ ...prev, visible: false }));
        return;
      }
      const node = linkRefs.current[activeIndex];
      if (node === null || node === undefined) {
        return;
      }
      setPill({
        top: node.offsetTop,
        height: node.offsetHeight,
        visible: true,
      });
    };

    if (typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(update);
      return () => window.cancelAnimationFrame(frame);
    }

    const timeout = window.setTimeout(update, 0);
    return () => window.clearTimeout(timeout);
  }, [activeIndex]);

  return (
    <div className={styles.footer}>
      <nav className={styles.footerLinks} aria-label="AURA public navigation">
        {/*
         * Sliding active-route highlight. Rendered as the first
         * sibling so default stacking-context paint order layers it
         * BEHIND the link text (the links carry `position: relative`
         * in the stylesheet so they win against this positioned
         * span). CSS variables drive position + height so a single
         * `transform` transition handles the slide between rows in
         * one motion; `opacity` handles the mount fade-in and the
         * no-active-route fade-out without ever snapping the pill
         * to a wrong row.
         */}
        <span
          className={styles.activePill}
          aria-hidden="true"
          style={
            {
              "--pill-top": `${pill.top}px`,
              "--pill-height": `${pill.height}px`,
              opacity: pill.visible ? 1 : 0,
            } as React.CSSProperties
          }
        />
        {FOOTER_LINKS.map((link, index) => (
          <NavLink
            key={link.label}
            to={link.to}
            end={link.end}
            ref={(el) => {
              linkRefs.current[index] = el;
            }}
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
