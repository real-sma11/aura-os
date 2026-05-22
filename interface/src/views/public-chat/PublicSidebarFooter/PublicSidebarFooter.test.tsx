/**
 * Smoke test for `PublicSidebarFooter`. Pins the four marketing-site
 * links + their external URLs so a regression that swaps a label or
 * href is caught.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicSidebarFooter } from "./PublicSidebarFooter";

describe("PublicSidebarFooter", () => {
  it("renders the four marketing-site links with external hrefs and rel='noreferrer'", () => {
    render(<PublicSidebarFooter />);

    const cases = [
      { label: "Product", href: "https://aura.ai/product" },
      { label: "Changelog", href: "https://aura.ai/changelog" },
      { label: "Feedback", href: "https://aura.ai/roadmap" },
      { label: "Pricing", href: "https://aura.ai/pricing" },
    ];

    for (const { label, href } of cases) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("rel", "noreferrer");
      expect(link).toHaveAttribute("target", "_blank");
    }
  });
});
