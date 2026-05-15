import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PricingView } from "./PricingView";

function renderPricingView() {
  return render(
    <MemoryRouter>
      <PricingView />
    </MemoryRouter>,
  );
}

describe("PricingView", () => {
  it("renders the Pricing heading", () => {
    renderPricingView();
    expect(
      screen.getByRole("heading", { level: 1, name: /Pricing/ }),
    ).toBeInTheDocument();
  });

  it("renders all four plan names", () => {
    renderPricingView();
    for (const name of ["Mortal", "Pro", "Crusader", "Sage"]) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
  });
});