import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { MarketingNavbar } from "../MarketingNavbar";
import { MarketingFooter } from "../MarketingFooter";
import styles from "./MarketingShell.module.css";

/**
 * Layout wrapper for the logged-out marketing pages
 * (`/product`, `/changelog`, `/feedback`, `/pricing`). The shell paints
 * the fixed dark background, mounts the shared navbar + footer, and
 * renders the per-page view through `<Outlet />`. The actual route
 * tree is wired up in `App.tsx` under the `!showShell` branch in the
 * follow-up phase.
 *
 * Two side-effects worth knowing about:
 *
 * 1. `data-marketing-shell="true"` is stamped on `<html>` while this
 *    component is mounted. The matching rule in `index.css` reverts the
 *    global `overflow: hidden` lock so marketing pages can scroll
 *    normally on mobile/desktop. Cleanup removes the attribute on unmount.
 *
 * 2. `document.title` is set to `"AURA"` as a sensible default. Per-view
 *    titles (set in the page components by the next phase) win because
 *    React effects run in render-tree order — children commit after the
 *    parent shell, so a child `useEffect` that updates the title runs
 *    last.
 */
export function MarketingShell(): React.ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.documentElement.setAttribute("data-marketing-shell", "true");
    document.title = "AURA";

    return () => {
      document.documentElement.removeAttribute("data-marketing-shell");
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className={styles.marketingPage}>
      <MarketingNavbar />
      <main className={styles.scrollMain}>
        <Outlet />
      </main>
      <MarketingFooter />
    </div>
  );
}
