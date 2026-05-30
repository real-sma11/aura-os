import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./SessionCostSection.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { SessionCostSection, type SessionCostView } from "./SessionCostSection";

function fixtureView(overrides: Partial<SessionCostView> = {}): SessionCostView {
  return {
    modelLabel: "Opus 4.8",
    inputTokens: 1_240_500,
    outputTokens: 310_200,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 1_550_700,
    avgCostPerMillionUsd: 11.8,
    totalCostUsd: 9.62,
    inputRatePerMillionUsd: 6,
    outputRatePerMillionUsd: 30,
    cachedRatePerMillionUsd: 0.6,
    unknown: false,
    ...overrides,
  };
}

describe("SessionCostSection", () => {
  it("renders model, token counts, and total cost", () => {
    render(<SessionCostSection view={fixtureView()} />);

    expect(screen.getByText("Session Cost")).toBeInTheDocument();
    expect(screen.getByText("Opus 4.8")).toBeInTheDocument();
    expect(screen.getByText("1,240,500")).toBeInTheDocument();
    expect(screen.getByText("310,200")).toBeInTheDocument();
    expect(screen.getByText("1,550,700")).toBeInTheDocument();
    expect(screen.getByText("$9.62")).toBeInTheDocument();
    expect(screen.getByText("$11.80 / 1M")).toBeInTheDocument();
  });

  it("exposes the per-type rates via the overlay", async () => {
    const user = userEvent.setup();
    render(<SessionCostSection view={fixtureView()} />);

    await user.click(screen.getByRole("button", { name: /per-type token rates/i }));

    const dialog = await screen.findByRole("dialog", { name: /cost per token rates/i });
    expect(dialog).toHaveTextContent("Input");
    expect(dialog).toHaveTextContent("$6.00 / 1M");
    expect(dialog).toHaveTextContent("$30.00 / 1M");
    expect(dialog).toHaveTextContent("Cached (read)");
    expect(dialog).toHaveTextContent("$0.60 / 1M");
    expect(dialog).toHaveTextContent("1 Z = $0.01");
  });

  it("shows a dash and note when pricing is unknown", () => {
    render(<SessionCostSection view={fixtureView({ unknown: true })} />);

    expect(screen.getByText("Pricing unavailable for this model.")).toBeInTheDocument();
  });
});
