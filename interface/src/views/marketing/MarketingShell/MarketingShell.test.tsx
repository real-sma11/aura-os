import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MarketingShell } from "./MarketingShell";

function renderShell(initialPath: string = "/product") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<MarketingShell />}>
          <Route
            path="product"
            element={<div data-testid="child-view">Product page</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("MarketingShell", () => {
  it("renders the marketing navbar logo and the nested outlet", () => {
    renderShell();

    // The navbar ships at least one AURA logo image; the footer ships another.
    // Both have `alt="AURA"`, so we assert there's >= 1 navbar logo by class.
    const logos = screen.getAllByAltText("AURA");
    expect(logos.length).toBeGreaterThanOrEqual(1);
    const navbarLogos = logos.filter((img) =>
      img.className.includes("titleLogo"),
    );
    expect(navbarLogos.length).toBe(1);

    expect(screen.getByTestId("child-view")).toBeInTheDocument();
  });

  it("sets data-marketing-shell on <html> while mounted and cleans up on unmount", () => {
    const { unmount } = renderShell();
    expect(
      document.documentElement.getAttribute("data-marketing-shell"),
    ).toBe("true");

    unmount();
    expect(
      document.documentElement.getAttribute("data-marketing-shell"),
    ).toBeNull();
  });

  it("renders the Log In and Sign Up CTAs in the navbar", () => {
    renderShell();

    // Two each: one in the desktop action row and one in the mobile drawer.
    expect(screen.getAllByRole("link", { name: "Log In" }).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("link", { name: "Sign Up" }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
