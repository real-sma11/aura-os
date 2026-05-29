import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MediaGenerationPlaceholder } from "./MediaGenerationPlaceholder";

describe("MediaGenerationPlaceholder", () => {
  it("renders an image-kind frame with the 'Creating image' label", () => {
    render(<MediaGenerationPlaceholder kind="image" />);
    const frame = screen.getByRole("status", { name: "Creating image" });
    expect(frame).toBeInTheDocument();
    expect(screen.getByText("Creating image")).toBeInTheDocument();
  });

  it("renders a video-kind frame with the 'Creating video' label", () => {
    render(<MediaGenerationPlaceholder kind="video" />);
    expect(
      screen.getByRole("status", { name: "Creating video" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Creating video")).toBeInTheDocument();
  });

  it("shows a rounded percent hint when a positive percent is provided", () => {
    render(<MediaGenerationPlaceholder kind="image" percent={42.6} />);
    expect(screen.getByText("43%")).toBeInTheDocument();
  });

  it("omits the percent hint when percent is null or non-positive", () => {
    const { rerender } = render(
      <MediaGenerationPlaceholder kind="image" percent={null} />,
    );
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();

    rerender(<MediaGenerationPlaceholder kind="image" percent={0} />);
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});
