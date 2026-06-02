import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SupportView } from "./SupportView";

describe("SupportView", () => {
  it("renders the Support heading", () => {
    render(<SupportView />);
    expect(
      screen.getByRole("heading", { name: "Support", level: 1 }),
    ).toBeInTheDocument();
  });

  it("exposes a mailto link to the support address", () => {
    render(<SupportView />);
    const link = screen.getByRole("link", { name: "support@aura.ai" });
    expect(link).toHaveAttribute("href", "mailto:support@aura.ai");
  });

  it("tells users what to include for account or billing questions", () => {
    render(<SupportView />);
    expect(
      screen.getByText(/email address\s+associated with your AURA account/i),
    ).toBeInTheDocument();
  });
});
