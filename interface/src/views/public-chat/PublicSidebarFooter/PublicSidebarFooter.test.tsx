/**
 * Smoke test for `PublicSidebarFooter`. Pins the four marketing-route
 * links + their internal hrefs and verifies the active-route highlight
 * fires for the matching `NavLink` so a regression that swaps a label,
 * destination, or active-class hookup is caught.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PublicSidebarFooter } from "./PublicSidebarFooter";
import styles from "./PublicSidebarFooter.module.css";

const CASES = [
  { label: "Product", to: "/product" },
  { label: "Changelog", to: "/changelog" },
  { label: "Feedback", to: "/feedback" },
  { label: "Pricing", to: "/pricing" },
] as const;

describe("PublicSidebarFooter", () => {
  it("renders the four marketing-route links with internal hrefs", () => {
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

  it("flags the matching link as active when routed to its target", () => {
    render(
      <MemoryRouter initialEntries={["/changelog"]}>
        <PublicSidebarFooter />
      </MemoryRouter>,
    );

    const active = screen.getByRole("link", { name: "Changelog" });
    expect(active.className).toContain(styles.footerLinkActive);
    expect(active).toHaveAttribute("aria-current", "page");

    for (const label of ["Product", "Feedback", "Pricing"]) {
      const inactive = screen.getByRole("link", { name: label });
      expect(inactive.className).not.toContain(styles.footerLinkActive);
      expect(inactive).not.toHaveAttribute("aria-current");
    }
  });
});
