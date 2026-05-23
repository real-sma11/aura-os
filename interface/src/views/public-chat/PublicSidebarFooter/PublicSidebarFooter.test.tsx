/**
 * Smoke test for `PublicSidebarFooter`. Pins the six public sidebar
 * links + their internal hrefs and verifies the active-route highlight
 * fires for the matching `NavLink` so a regression that swaps a label,
 * destination, or active-class hookup is caught. Also asserts that
 * Home defaults to active on `/` (the public-mode entrypoint) and
 * doesn't latch on for nested public routes.
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
  { label: "Chat", to: "/chat" },
] as const;

describe("PublicSidebarFooter", () => {
  it("renders the six public sidebar links with internal hrefs", () => {
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

    for (const label of ["Product", "Changelog", "Feedback", "Pricing", "Chat"]) {
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

    for (const label of ["Home", "Product", "Feedback", "Pricing", "Chat"]) {
      const inactive = screen.getByRole("link", { name: label });
      expect(inactive.className).not.toContain(styles.footerLinkActive);
      expect(inactive).not.toHaveAttribute("aria-current");
    }
  });

  it("flags Chat active on /chat", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <PublicSidebarFooter />
      </MemoryRouter>,
    );

    const chat = screen.getByRole("link", { name: "Chat" });
    expect(chat.className).toContain(styles.footerLinkActive);
    expect(chat).toHaveAttribute("aria-current", "page");
  });

  it("does not latch Home active on nested public routes", () => {
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
