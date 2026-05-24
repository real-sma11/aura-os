import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CookingIndicator } from "./CookingIndicator";

vi.mock("./CookingIndicator.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("CookingIndicator", () => {
  it("renders the shimmering label by default", () => {
    render(<CookingIndicator />);
    expect(screen.getByText("Cooking...")).toBeInTheDocument();
  });

  it("renders nothing when hidden=true", () => {
    const { container } = render(<CookingIndicator hidden />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the optional countdown chip when provided", () => {
    render(<CookingIndicator label="Generating image..." countdown="0:42" />);
    expect(screen.getByText("Generating image...")).toBeInTheDocument();
    const chip = screen.getByLabelText("Estimated time remaining");
    expect(chip).toHaveTextContent("0:42");
  });

  it("hides the countdown slot when null / empty / undefined", () => {
    const { rerender } = render(
      <CookingIndicator label="Cooking..." countdown={null} />,
    );
    expect(
      screen.queryByLabelText("Estimated time remaining"),
    ).not.toBeInTheDocument();

    rerender(<CookingIndicator label="Cooking..." countdown="" />);
    expect(
      screen.queryByLabelText("Estimated time remaining"),
    ).not.toBeInTheDocument();

    rerender(<CookingIndicator label="Cooking..." />);
    expect(
      screen.queryByLabelText("Estimated time remaining"),
    ).not.toBeInTheDocument();
  });
});
