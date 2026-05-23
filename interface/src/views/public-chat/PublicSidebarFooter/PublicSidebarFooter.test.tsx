/**
 * Smoke test for `PublicSidebarFooter`. Pins the five marketing-route
 * links + their internal hrefs and verifies the active-route highlight
 * fires for the matching `NavLink` so a regression that swaps a label,
 * destination, or active-class hookup is caught. Also asserts that
 * Home defaults to active on `/` (the public-mode entrypoint) and
 * doesn't latch on for nested marketing routes.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PublicSidebarFooter } from "./PublicSidebarFooter";
import styles from "./PublicSidebarFooter.module.css";

const CASES = [
  { label: "Home", to: "/" },
  { label: "Product", to: "/product" },
  { label: "Changelog", to: "/changelog" },
  { label: "Feedback", to: "/feedback" },
  { label: "Pricing", to: "/pricing" },
] as const;

describe("PublicSidebarFooter", () => {
  it("renders the five marketing-route links with internal hrefs", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PublicSidebarFooter />
      </MemoryRouter>,
    );

    for (const { label, to } of CASES) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", to);
      // No `target` / `rel` — these are in-app NavLinks, not external
      // anchors. Asserting absence catches a regression that
      // accidentally re-introduces the previous external behavior.
      expect(link).not.toHaveAttribute("target");
      expect(link).not.toHaveAttribute("rel");
    }
  });

  it("flags Home as active by default on the / entrypoint", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PublicSidebarFooter />
      </MemoryRouter>,
    );

    const home = screen.getByRole("link", { name: "Home" });
    expect(home.className).toContain(styles.footerLinkActive);
    expect(home).toHaveAttribute("aria-current", "page");

    for (const label of ["Product", "Changelog", "Feedback", "Pricing"]) {
      const inactive = screen.getByRole("link", { name: label });
      expect(inactive.className).not.toContain(styles.footerLinkActive);
      expect(inactive).not.toHaveAttribute("aria-current");
    }
  });

  it("flags the matching link as active when routed to its target", () => {
    render(
      <MemoryRouter initialEntries={["/changelog"]}>
        <PublicSidebarFooter />
      </MemoryRouter>,
    );

    const active = screen.getByRole("link", { name: "Changelog" });
    expect(active.className).toContain(styles.footerLinkActive);
    expect(active).toHaveAttribute("aria-current", "page");

    for (const label of ["Home", "Product", "Feedback", "Pricing"]) {
      const inactive = screen.getByRole("link", { name: label });
      expect(inactive.className).not.toContain(styles.footerLinkActive);
      expect(inactive).not.toHaveAttribute("aria-current");
    }
  });

  it("does not latch Home active on nested marketing routes", () => {
    // Without `end: true` on the Home link, `NavLink` would treat
    // every pathname as descended from "/" and flag Home active for
    // /product, /changelog, etc. Pin the exact-match behavior here.
    render(
      <MemoryRouter initialEntries={["/product"]}>
        <PublicSidebarFooter />
      </MemoryRouter>,
    );

    const home = screen.getByRole("link", { name: "Home" });
    expect(home.className).not.toContain(styles.footerLinkActive);
    expect(home).not.toHaveAttribute("aria-current");
  });
});
