import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CouncilMechanismRow } from "./CouncilMechanismRow";

vi.mock("./InputBarShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("CouncilMechanismRow", () => {
  it("renders all three mechanisms and marks the active one", () => {
    render(<CouncilMechanismRow mechanism="side_by_side" onSelect={vi.fn()} />);

    const synthesize = screen.getByText("Synthesize").closest("button");
    const contrast = screen.getByText("Contrast").closest("button");
    const sideBySide = screen.getByText("Side-by-side").closest("button");

    expect(synthesize).toHaveAttribute("aria-pressed", "false");
    expect(contrast).toHaveAttribute("aria-pressed", "false");
    expect(sideBySide).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onSelect with the clicked mechanism", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CouncilMechanismRow mechanism="synthesize" onSelect={onSelect} />);

    await user.click(screen.getByText("Contrast"));

    expect(onSelect).toHaveBeenCalledWith("contrast");
  });

  it("reflects a changed mechanism prop in the active row", () => {
    const { rerender } = render(
      <CouncilMechanismRow mechanism="synthesize" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Synthesize").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    rerender(<CouncilMechanismRow mechanism="contrast" onSelect={vi.fn()} />);
    expect(screen.getByText("Synthesize").closest("button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("Contrast").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
